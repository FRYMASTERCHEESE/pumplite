// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LaunchTokenV2} from "./LaunchTokenV2.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice PumpLite V2 bonding-curve market.
/// Mayhem changes future trade economics only; it never creates fake trades
/// or directly edits a displayed token price.
contract CurveMarketV2 is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant PLATFORM_FEE_BPS = 25; // 0.25%
    uint256 public constant MAYHEM_SUPPORT_BPS = 75; // 0.75% retained as backing
    uint256 public constant VIRTUAL_NATIVE = 1 ether;

    uint256 public constant MIN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000_000 ether;
    uint256 public constant INITIAL_MAYHEM_DURATION = 24 hours;

    LaunchTokenV2 public immutable token;
    address public immutable creator;
    address public immutable mayhemController;
    address payable public immutable treasury;

    string public metadataURI;

    uint256 public immutable launchedAt;
    uint256 public immutable initialSupply;
    bool public immutable initialMayhem;

    bool public manualMayhem;

    uint256 public nativeReserve;
    uint256 public tokenReserve;
    uint256 public volume;
    uint256 public totalMarketSupport;
    uint256 public totalBurned;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidSupply();
    error Unauthorized();
    error Liquidity();
    error Slippage();
    error Expired();
    error TransferFailed();
    error Backing();
    error InitialMayhemWindowActive();

    event Trade(
        address indexed trader,
        bool indexed isBuy,
        uint256 input,
        uint256 output,
        uint256 platformFee,
        uint256 mayhemSupport,
        bool mayhemActive
    );

    event MayhemChanged(
        address indexed controller,
        bool enabled,
        uint256 changedAt
    );

    event MarketSupported(
        address indexed controller,
        uint256 amount,
        uint256 newNativeReserve
    );

    event BuyAndBurn(
        address indexed buyer,
        uint256 input,
        uint256 tokensBurned,
        uint256 platformFee,
        uint256 mayhemSupport
    );

    event InventoryMinted(
        address indexed creator,
        uint256 amount,
        uint256 newTokenReserve,
        uint256 totalSupply
    );

    event MintingLocked(address indexed creator);

    modifier onlyCreator() {
        if (msg.sender != creator) revert Unauthorized();
        _;
    }

    modifier onlyMayhemController() {
        if (msg.sender != mayhemController) revert Unauthorized();
        _;
    }

    struct LaunchConfig {
        string name;
        string symbol;
        string uri;
        uint256 initialSupply;
        uint256 maxSupply;
        bool mintable;
        bool initialMayhem;
    }

    constructor(
        address creator_,
        address mayhemController_,
        address payable treasury_,
        LaunchConfig memory config
    ) {
        if (
            creator_ == address(0) ||
            mayhemController_ == address(0) ||
            treasury_ == address(0)
        ) revert InvalidAddress();

        if (
            config.initialSupply < MIN_SUPPLY ||
            config.initialSupply > config.maxSupply ||
            config.maxSupply > MAX_SUPPLY
        ) revert InvalidSupply();

        creator = creator_;
        mayhemController = mayhemController_;
        treasury = treasury_;
        metadataURI = config.uri;
        launchedAt = block.timestamp;
        initialSupply = config.initialSupply;
        initialMayhem = config.initialMayhem;

        token = new LaunchTokenV2(
            config.name,
            config.symbol,
            config.initialSupply,
            config.maxSupply,
            config.mintable
        );

        tokenReserve = config.initialSupply;
    }

    function mayhemActive() public view returns (bool) {
        if (
            initialMayhem &&
            block.timestamp < launchedAt + INITIAL_MAYHEM_DURATION
        ) {
            return true;
        }

        if (block.timestamp < launchedAt + INITIAL_MAYHEM_DURATION) {
            return false;
        }

        return manualMayhem;
    }

    /// @notice After the first 24 hours, only PumpLite's controller
    /// can switch Mayhem on or off for this market.
    function setMayhem(bool enabled) external onlyMayhemController {
        if (block.timestamp < launchedAt + INITIAL_MAYHEM_DURATION) {
            revert InitialMayhemWindowActive();
        }

        manualMayhem = enabled;

        emit MayhemChanged(
            msg.sender,
            enabled,
            block.timestamp
        );
    }

    /// @notice Adds real native backing to the market.
    /// There is deliberately no controller withdrawal function.
    function supportMarket()
        external
        payable
        onlyMayhemController
        nonReentrant
    {
        if (msg.value == 0) revert InvalidAmount();

        nativeReserve += msg.value;
        totalMarketSupport += msg.value;

        emit MarketSupported(
            msg.sender,
            msg.value,
            nativeReserve
        );
    }

    /// @notice Creator can add supply only when the token was launched
    /// as mintable and only up to its immutable maximum lifetime mint.
    /// Newly minted inventory goes directly into the market.
    function mintInventory(uint256 amount)
        external
        onlyCreator
        nonReentrant
    {
        if (amount == 0) revert InvalidAmount();

        token.mintToMarket(amount);
        tokenReserve += amount;

        emit InventoryMinted(
            msg.sender,
            amount,
            tokenReserve,
            token.totalSupply()
        );
    }

    /// @notice Permanently disables future minting.
    function lockMintingForever()
        external
        onlyCreator
    {
        token.lockMintingForever();
        emit MintingLocked(msg.sender);
    }

    function quoteBuy(uint256 input)
        public
        view
        returns (
            uint256 output,
            uint256 platformFee,
            uint256 mayhemSupport
        )
    {
        if (input == 0) revert InvalidAmount();

        platformFee = Math.mulDiv(
            input,
            PLATFORM_FEE_BPS,
            BPS
        );

        if (mayhemActive()) {
            mayhemSupport = Math.mulDiv(
                input,
                MAYHEM_SUPPORT_BPS,
                BPS
            );
        }

        uint256 curveInput =
            input - platformFee - mayhemSupport;

        if (curveInput == 0) revert InvalidAmount();

        output = Math.mulDiv(
            tokenReserve,
            curveInput,
            VIRTUAL_NATIVE + nativeReserve + curveInput
        );

        if (
            output == 0 ||
            output >= tokenReserve
        ) revert Liquidity();
    }

    function quoteSell(uint256 input)
        public
        view
        returns (
            uint256 output,
            uint256 platformFee,
            uint256 mayhemSupport
        )
    {
        if (input == 0) revert InvalidAmount();

        uint256 outstanding =
            token.totalSupply() - tokenReserve;

        if (input > outstanding) revert InvalidAmount();

        uint256 gross = Math.mulDiv(
            VIRTUAL_NATIVE + nativeReserve,
            input,
            tokenReserve + input
        );

        if (
            gross == 0 ||
            gross > nativeReserve
        ) revert Liquidity();

        platformFee = Math.mulDiv(
            gross,
            PLATFORM_FEE_BPS,
            BPS
        );

        if (mayhemActive()) {
            mayhemSupport = Math.mulDiv(
                gross,
                MAYHEM_SUPPORT_BPS,
                BPS
            );
        }

        output =
            gross - platformFee - mayhemSupport;

        if (output == 0) revert Liquidity();
    }

    function buy(
        uint256 minimumOutput,
        uint256 deadline
    )
        external
        payable
        nonReentrant
        returns (uint256 output)
    {
        _deadline(deadline, minimumOutput);

        if (
            address(this).balance < nativeReserve + msg.value ||
            token.balanceOf(address(this)) < tokenReserve
        ) revert Backing();

        uint256 platformFee;
        uint256 mayhemSupport;

        (output, platformFee, mayhemSupport) =
            quoteBuy(msg.value);

        if (output < minimumOutput) revert Slippage();

        // Platform fee leaves the market.
        // Mayhem support stays inside nativeReserve as real backing.
        nativeReserve += msg.value - platformFee;
        tokenReserve -= output;
        volume += msg.value;
        totalMarketSupport += mayhemSupport;

        if (!token.transfer(msg.sender, output)) {
            revert TransferFailed();
        }

        _pay(treasury, platformFee);

        emit Trade(
            msg.sender,
            true,
            msg.value,
            output,
            platformFee,
            mayhemSupport,
            mayhemActive()
        );
    }

    function sell(
        uint256 input,
        uint256 minimumOutput,
        uint256 deadline
    )
        external
        nonReentrant
        returns (uint256 output)
    {
        _deadline(deadline, minimumOutput);

        if (
            address(this).balance < nativeReserve ||
            token.balanceOf(address(this)) < tokenReserve
        ) revert Backing();

        uint256 platformFee;
        uint256 mayhemSupport;

        (output, platformFee, mayhemSupport) =
            quoteSell(input);

        if (output < minimumOutput) revert Slippage();

        uint256 gross =
            output + platformFee + mayhemSupport;

        // Mayhem support remains in the market.
        uint256 nativeLeaving =
            output + platformFee;

        if (nativeLeaving > nativeReserve) {
            revert Liquidity();
        }

        if (
            !token.transferFrom(
                msg.sender,
                address(this),
                input
            )
        ) revert TransferFailed();

        nativeReserve -= nativeLeaving;
        tokenReserve += input;
        volume += gross;
        totalMarketSupport += mayhemSupport;

        _pay(treasury, platformFee);
        _pay(payable(msg.sender), output);

        emit Trade(
            msg.sender,
            false,
            input,
            output,
            platformFee,
            mayhemSupport,
            mayhemActive()
        );
    }

    /// @notice Anyone can spend native currency to purchase tokens
    /// from the real curve and permanently burn the purchased inventory.
    function buyAndBurn(
        uint256 minimumTokensBurned,
        uint256 deadline
    )
        external
        payable
        nonReentrant
        returns (uint256 tokensBurned)
    {
        _deadline(deadline, minimumTokensBurned);

        if (
            address(this).balance < nativeReserve + msg.value ||
            token.balanceOf(address(this)) < tokenReserve
        ) revert Backing();

        uint256 platformFee;
        uint256 mayhemSupport;

        (
            tokensBurned,
            platformFee,
            mayhemSupport
        ) = quoteBuy(msg.value);

        if (tokensBurned < minimumTokensBurned) {
            revert Slippage();
        }

        nativeReserve += msg.value - platformFee;
        tokenReserve -= tokensBurned;
        volume += msg.value;
        totalMarketSupport += mayhemSupport;
        totalBurned += tokensBurned;

        token.burnFromMarket(tokensBurned);

        _pay(treasury, platformFee);

        emit BuyAndBurn(
            msg.sender,
            msg.value,
            tokensBurned,
            platformFee,
            mayhemSupport
        );
    }

    function _deadline(
        uint256 deadline,
        uint256 minimumOutput
    ) private view {
        if (minimumOutput == 0) revert Slippage();

        if (
            deadline < block.timestamp ||
            deadline > block.timestamp + 300
        ) revert Expired();
    }

    function _pay(
        address payable to,
        uint256 amount
    ) private {
        if (amount == 0) return;

        (bool success,) = to.call{value: amount}("");

        if (!success) revert TransferFailed();
    }
}
