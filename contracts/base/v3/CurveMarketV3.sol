// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LaunchTokenV3} from "./LaunchTokenV3.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice PumpLite V3 bonding-curve market with immutable launch modes:
/// Classic, Mayhem Auto and Mayhem Manual.
///
/// Mayhem agent activity is deliberately segregated from organic user volume.
/// Agent trades have their own event and counters and never masquerade as
/// ordinary Trade events.
contract CurveMarketV3 is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant PLATFORM_FEE_BPS = 25;
    uint256 public constant MAYHEM_SUPPORT_BPS = 75;
    uint256 public constant VIRTUAL_NATIVE = 1 ether;
    uint256 public constant MAYHEM_DURATION = 24 hours;

    uint256 public constant MIN_SUPPLY =
        1_000_000_000 ether;

    uint256 public constant MAX_SUPPLY =
        1_000_000_000_000_000 ether;

    enum LaunchMode {
        Classic,
        MayhemAuto,
        MayhemManual
    }

    enum MayhemState {
        Classic,
        Active,
        Paused,
        Ended
    }

    struct LaunchConfig {
        string name;
        string symbol;
        string uri;
        uint256 initialSupply;
        uint256 maxSupply;
        bool mintable;
        uint8 launchMode;
    }

    struct MayhemLimits {
        uint128 minBuy;
        uint128 maxBuy;
        uint128 maxTotalBuy;
        uint128 maxTotalSell;
        uint128 pauseBelowNativeReserve;
        uint32 minInterval;
        uint16 maxTrades;
        uint16 minSellBps;
        uint16 maxSellBps;
    }

    LaunchTokenV3 public immutable token;
    address public immutable creator;
    address public immutable mayhemController;
    address payable public immutable treasury;
    address payable public immutable mayhemFeeTreasury;

    LaunchMode public immutable launchMode;
    MayhemLimits public limits;

    string public metadataURI;

    uint256 public immutable launchedAt;
    uint256 public immutable initialSupply;

    /// @notice Compatibility getter for existing PumpLite market readers.
    bool public immutable initialMayhem;

    /// @notice Regular curve backing and inventory.
    uint256 public nativeReserve;
    uint256 public tokenReserve;

    /// @notice Organic user activity only. Mayhem agent activity is excluded.
    uint256 public volume;

    uint256 public totalMarketSupport;
    uint256 public totalBurned;

    /// @notice Segregated Mayhem inventory held by this market contract.
    uint256 public agentInventory;

    /// @notice Mayhem-only counters. These are never added into organic volume.
    uint256 public agentVolume;
    uint256 public agentNativeIn;
    uint256 public agentNativeOut;
    uint256 public mayhemTradeCount;
    uint256 public lastAgentTradeAt;

    uint256 public manualRequestNonce;
    bool public pendingManualRequest;

    bytes32 public mayhemCommitment;
    uint256 public mayhemCommitBlock;
    uint256 public expiredCommitments;

    bool public mayhemFinalized;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidSupply();
    error InvalidLaunchMode();
    error InvalidMayhemLimits();
    error Unauthorized();
    error Liquidity();
    error Slippage();
    error Expired();
    error TransferFailed();
    error Backing();
    error ClassicMode();
    error WrongMayhemMode();
    error MayhemEnded();
    error MayhemPaused();
    error MayhemInterval();
    error MayhemLimit();
    error PendingCommitment();
    error MissingCommitment();
    error RevealTooEarly();
    error RevealExpired();
    error BadReveal();
    error ManualRequestRequired();
    error ManualRequestAlreadyPending();
    error FinalizeNotReady();
    error ImmutableLaunchMode();

    event Trade(
        address indexed trader,
        bool indexed isBuy,
        uint256 input,
        uint256 output,
        uint256 platformFee,
        uint256 mayhemSupport,
        bool mayhemActive
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

    event ManualMayhemTradeRequested(
        address indexed creator,
        uint256 indexed requestNonce
    );

    event MayhemTradeCommitted(
        address indexed controller,
        bytes32 indexed commitment,
        uint256 blockNumber,
        uint256 requestNonce,
        uint256 completedTrades
    );

    event MayhemAgentTrade(
        address indexed controller,
        bool indexed isBuy,
        uint256 nativeAmount,
        uint256 tokenAmount,
        bytes32 randomness,
        uint256 indexed tradeNumber
    );

    event MayhemCommitmentExpired(
        bytes32 indexed commitment,
        uint256 blockNumber
    );

    event MayhemFinalized(
        uint256 unusedInventoryBurned,
        uint256 completedTrades,
        uint256 agentNativeIn,
        uint256 agentNativeOut
    );

    modifier onlyCreator() {
        if (msg.sender != creator) revert Unauthorized();
        _;
    }

    modifier onlyMayhemController() {
        if (msg.sender != mayhemController) {
            revert Unauthorized();
        }
        _;
    }

    constructor(
        address creator_,
        address mayhemController_,
        address payable treasury_,
        address payable mayhemFeeTreasury_,
        MayhemLimits memory limits_,
        LaunchConfig memory config
    ) {
        if (
            creator_ == address(0) ||
            mayhemController_ == address(0) ||
            treasury_ == address(0) ||
            mayhemFeeTreasury_ == address(0)
        ) revert InvalidAddress();

        if (
            config.initialSupply < MIN_SUPPLY ||
            config.initialSupply > config.maxSupply ||
            config.maxSupply > MAX_SUPPLY
        ) revert InvalidSupply();

        if (
            !config.mintable &&
            config.initialSupply != config.maxSupply
        ) revert InvalidSupply();

        if (
            config.launchMode >
            uint8(LaunchMode.MayhemManual)
        ) revert InvalidLaunchMode();

        _validateLimits(limits_);

        creator = creator_;
        mayhemController = mayhemController_;
        treasury = treasury_;
        mayhemFeeTreasury = mayhemFeeTreasury_;
        limits = limits_;
        metadataURI = config.uri;
        launchedAt = block.timestamp;
        initialSupply = config.initialSupply;
        launchMode = LaunchMode(config.launchMode);
        initialMayhem =
            launchMode != LaunchMode.Classic;

        uint256 mayhemGenesis =
            initialMayhem
                ? config.initialSupply
                : 0;

        token = new LaunchTokenV3(
            config.name,
            config.symbol,
            config.initialSupply,
            config.maxSupply,
            mayhemGenesis,
            config.mintable
        );

        tokenReserve = config.initialSupply;
        agentInventory = mayhemGenesis;
    }

    function _validateLimits(
        MayhemLimits memory value
    ) private pure {
        if (
            value.minBuy == 0 ||
            value.maxBuy < value.minBuy ||
            value.maxTotalBuy < value.maxBuy ||
            value.maxTotalSell == 0 ||
            value.maxTrades == 0 ||
            value.minSellBps == 0 ||
            value.maxSellBps < value.minSellBps ||
            value.maxSellBps > BPS ||
            value.minInterval > 1 hours
        ) revert InvalidMayhemLimits();
    }

    /// @notice Compatibility/readability getter.
    function manualMayhem()
        external
        view
        returns (bool)
    {
        return
            launchMode ==
            LaunchMode.MayhemManual;
    }

    function mayhemEndsAt()
        public
        view
        returns (uint256)
    {
        return launchedAt + MAYHEM_DURATION;
    }

    function _endCondition()
        private
        view
        returns (bool)
    {
        return
            block.timestamp >= mayhemEndsAt() ||
            mayhemTradeCount >= limits.maxTrades ||
            (
                agentNativeIn >= limits.maxTotalBuy &&
                agentNativeOut >= limits.maxTotalSell
            );
    }

    function mayhemState()
        public
        view
        returns (MayhemState)
    {
        if (launchMode == LaunchMode.Classic) {
            return MayhemState.Classic;
        }

        if (mayhemFinalized || _endCondition()) {
            return MayhemState.Ended;
        }

        if (
            nativeReserve <
            limits.pauseBelowNativeReserve
        ) {
            return MayhemState.Paused;
        }

        return MayhemState.Active;
    }

    function mayhemActive()
        public
        view
        returns (bool)
    {
        MayhemState state = mayhemState();

        return
            state == MayhemState.Active ||
            state == MayhemState.Paused;
    }

    /// @notice V3 launch mode is immutable and cannot be toggled later.
    /// This compatibility method always reverts.
    function setMayhem(bool)
        external
        pure
    {
        revert ImmutableLaunchMode();
    }

    /// @notice Adds real ETH backing. There is no controller withdrawal.
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
            input -
            platformFee -
            mayhemSupport;

        if (curveInput == 0) revert InvalidAmount();

        output = Math.mulDiv(
            tokenReserve,
            curveInput,
            VIRTUAL_NATIVE +
                nativeReserve +
                curveInput
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
            token.totalSupply() -
            tokenReserve -
            agentInventory;

        if (input > outstanding) {
            revert InvalidAmount();
        }

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
            gross -
            platformFee -
            mayhemSupport;

        if (output == 0) revert Liquidity();
    }

    function _checkBacking()
        private
        view
    {
        if (
            address(this).balance < nativeReserve ||
            token.balanceOf(address(this)) <
                tokenReserve + agentInventory
        ) revert Backing();
    }

    function _feeRecipient()
        private
        view
        returns (address payable)
    {
        return
            launchMode == LaunchMode.Classic
                ? treasury
                : mayhemFeeTreasury;
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
            address(this).balance <
            nativeReserve + msg.value ||
            token.balanceOf(address(this)) <
                tokenReserve + agentInventory
        ) revert Backing();

        uint256 platformFee;
        uint256 mayhemSupport;

        (
            output,
            platformFee,
            mayhemSupport
        ) = quoteBuy(msg.value);

        if (output < minimumOutput) {
            revert Slippage();
        }

        nativeReserve +=
            msg.value - platformFee;

        tokenReserve -= output;
        volume += msg.value;
        totalMarketSupport += mayhemSupport;

        if (!token.transfer(msg.sender, output)) {
            revert TransferFailed();
        }

        _pay(
            _feeRecipient(),
            platformFee
        );

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
        _checkBacking();

        uint256 platformFee;
        uint256 mayhemSupport;

        (
            output,
            platformFee,
            mayhemSupport
        ) = quoteSell(input);

        if (output < minimumOutput) {
            revert Slippage();
        }

        uint256 gross =
            output +
            platformFee +
            mayhemSupport;

        uint256 nativeLeaving =
            output +
            platformFee;

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

        _pay(
            _feeRecipient(),
            platformFee
        );

        _pay(
            payable(msg.sender),
            output
        );

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

    function buyAndBurn(
        uint256 minimumTokensBurned,
        uint256 deadline
    )
        external
        payable
        nonReentrant
        returns (uint256 tokensBurned)
    {
        _deadline(
            deadline,
            minimumTokensBurned
        );

        if (
            address(this).balance <
            nativeReserve + msg.value ||
            token.balanceOf(address(this)) <
                tokenReserve + agentInventory
        ) revert Backing();

        uint256 platformFee;
        uint256 mayhemSupport;

        (
            tokensBurned,
            platformFee,
            mayhemSupport
        ) = quoteBuy(msg.value);

        if (
            tokensBurned <
            minimumTokensBurned
        ) revert Slippage();

        nativeReserve +=
            msg.value - platformFee;

        tokenReserve -= tokensBurned;
        volume += msg.value;
        totalMarketSupport += mayhemSupport;
        totalBurned += tokensBurned;

        token.burnFromMarket(
            tokensBurned
        );

        _pay(
            _feeRecipient(),
            platformFee
        );

        emit BuyAndBurn(
            msg.sender,
            msg.value,
            tokensBurned,
            platformFee,
            mayhemSupport
        );
    }

    /// @notice In Manual mode the creator may request one agent trade.
    /// The creator does not choose direction or trade size.
    function requestManualMayhemTrade()
        external
        onlyCreator
    {
        if (
            launchMode !=
            LaunchMode.MayhemManual
        ) revert WrongMayhemMode();

        if (
            mayhemState() ==
            MayhemState.Ended
        ) revert MayhemEnded();

        if (pendingManualRequest) {
            revert ManualRequestAlreadyPending();
        }

        pendingManualRequest = true;
        manualRequestNonce++;

        emit ManualMayhemTradeRequested(
            msg.sender,
            manualRequestNonce
        );
    }

    /// @notice Returns the commitment expected for the current Mayhem state.
    function mayhemCommitmentHash(
        bytes32 secret
    )
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                secret,
                address(this),
                manualRequestNonce,
                mayhemTradeCount
            )
        );
    }

    /// @notice First half of the verifiable-random Mayhem trade.
    /// The future block hash prevents choosing direction after commitment.
    function commitMayhemTrade(
        bytes32 commitment
    )
        external
        onlyMayhemController
    {
        if (
            launchMode ==
            LaunchMode.Classic
        ) revert ClassicMode();

        MayhemState state =
            mayhemState();

        if (state == MayhemState.Ended) {
            revert MayhemEnded();
        }

        if (state == MayhemState.Paused) {
            revert MayhemPaused();
        }

        if (commitment == bytes32(0)) {
            revert BadReveal();
        }

        if (
            mayhemCommitment != bytes32(0)
        ) revert PendingCommitment();

        if (
            lastAgentTradeAt != 0 &&
            block.timestamp <
                lastAgentTradeAt +
                limits.minInterval
        ) revert MayhemInterval();

        if (
            launchMode ==
                LaunchMode.MayhemManual &&
            !pendingManualRequest
        ) revert ManualRequestRequired();

        mayhemCommitment = commitment;
        mayhemCommitBlock = block.number;

        emit MayhemTradeCommitted(
            msg.sender,
            commitment,
            block.number,
            manualRequestNonce,
            mayhemTradeCount
        );
    }

    function previewMayhemReveal(
        bytes32 secret
    )
        external
        view
        returns (
            bool isBuy,
            uint256 nativeAmount,
            uint256 tokenAmount,
            bytes32 randomness
        )
    {
        return _previewMayhem(secret);
    }

    function _previewMayhem(
        bytes32 secret
    )
        private
        view
        returns (
            bool isBuy,
            uint256 nativeAmount,
            uint256 tokenAmount,
            bytes32 randomness
        )
    {
        if (
            mayhemCommitment == bytes32(0)
        ) revert MissingCommitment();

        if (
            mayhemCommitmentHash(secret) !=
            mayhemCommitment
        ) revert BadReveal();

        if (
            block.number <=
            mayhemCommitBlock
        ) revert RevealTooEarly();

        if (
            block.number >
            mayhemCommitBlock + 255
        ) revert RevealExpired();

        if (
            mayhemState() !=
            MayhemState.Active
        ) revert MayhemPaused();

        bytes32 committedBlockHash =
            blockhash(mayhemCommitBlock);

        if (
            committedBlockHash ==
            bytes32(0)
        ) revert RevealExpired();

        randomness = keccak256(
            abi.encode(
                secret,
                committedBlockHash,
                address(this),
                manualRequestNonce,
                mayhemTradeCount
            )
        );

        isBuy =
            (uint256(randomness) & 1) == 0;

        if (isBuy) {
            uint256 remaining =
                uint256(limits.maxTotalBuy) -
                agentNativeIn;

            if (
                remaining <
                limits.minBuy
            ) revert MayhemLimit();

            uint256 high =
                Math.min(
                    uint256(limits.maxBuy),
                    remaining
                );

            uint256 span =
                high -
                uint256(limits.minBuy) +
                1;

            nativeAmount =
                uint256(limits.minBuy) +
                (
                    uint256(randomness) %
                    span
                );

            tokenAmount =
                _quoteAgentBuy(
                    nativeAmount
                );

            return (
                isBuy,
                nativeAmount,
                tokenAmount,
                randomness
            );
        }

        if (agentInventory == 0) {
            revert Liquidity();
        }

        uint256 bpsSpan =
            uint256(limits.maxSellBps) -
            uint256(limits.minSellBps) +
            1;

        uint256 sellBps =
            uint256(limits.minSellBps) +
            (
                (
                    uint256(randomness) >>
                    128
                ) %
                bpsSpan
            );

        tokenAmount = Math.mulDiv(
            agentInventory,
            sellBps,
            BPS
        );

        if (tokenAmount == 0) {
            tokenAmount = 1;
        }

        uint256 remainingSell =
            uint256(limits.maxTotalSell) -
            agentNativeOut;

        if (remainingSell == 0) {
            revert MayhemLimit();
        }

        nativeAmount =
            _quoteAgentSell(
                tokenAmount
            );

        if (
            nativeAmount >
            remainingSell
        ) {
            uint256 pricingNative =
                VIRTUAL_NATIVE +
                nativeReserve;

            if (
                remainingSell >=
                pricingNative
            ) revert MayhemLimit();

            tokenAmount = Math.mulDiv(
                remainingSell,
                tokenReserve,
                pricingNative -
                    remainingSell
            );

            if (
                tokenAmount == 0 ||
                tokenAmount >
                    agentInventory
            ) revert MayhemLimit();

            nativeAmount =
                _quoteAgentSell(
                    tokenAmount
                );

            if (
                nativeAmount >
                remainingSell
            ) revert MayhemLimit();
        }
    }

    /// @notice Second half of a Mayhem trade.
    /// Agent buys/sells pay no PumpLite platform fee.
    /// Their activity is recorded only in Mayhem counters/events.
    function revealMayhemTrade(
        bytes32 secret
    )
        external
        payable
        onlyMayhemController
        nonReentrant
        returns (
            bool isBuy,
            uint256 nativeAmount,
            uint256 tokenAmount
        )
    {
        bytes32 randomness;

        (
            isBuy,
            nativeAmount,
            tokenAmount,
            randomness
        ) = _previewMayhem(secret);

        // Effects first. A failed value/custody check reverts all of them.
        mayhemCommitment = bytes32(0);
        mayhemCommitBlock = 0;

        if (
            launchMode ==
            LaunchMode.MayhemManual
        ) {
            pendingManualRequest = false;
        }

        if (isBuy) {
            if (
                msg.value !=
                nativeAmount
            ) revert InvalidAmount();

            if (
                address(this).balance <
                nativeReserve +
                    msg.value
            ) revert Backing();

            if (
                token.balanceOf(
                    address(this)
                ) <
                tokenReserve +
                    agentInventory
            ) revert Backing();

            nativeReserve +=
                nativeAmount;

            tokenReserve -=
                tokenAmount;

            agentInventory +=
                tokenAmount;

            agentNativeIn +=
                nativeAmount;

            agentVolume +=
                nativeAmount;
        } else {
            if (msg.value != 0) {
                revert InvalidAmount();
            }

            _checkBacking();

            if (
                tokenAmount >
                agentInventory ||
                nativeAmount >
                nativeReserve
            ) revert Liquidity();

            agentInventory -=
                tokenAmount;

            tokenReserve +=
                tokenAmount;

            nativeReserve -=
                nativeAmount;

            agentNativeOut +=
                nativeAmount;

            agentVolume +=
                nativeAmount;

            _pay(
                payable(msg.sender),
                nativeAmount
            );
        }

        mayhemTradeCount++;
        lastAgentTradeAt =
            block.timestamp;

        emit MayhemAgentTrade(
            msg.sender,
            isBuy,
            nativeAmount,
            tokenAmount,
            randomness,
            mayhemTradeCount
        );
    }

    /// @notice Anyone can clear an unrevealed commitment after blockhash expiry.
    function expireMayhemCommitment()
        external
    {
        bytes32 value =
            mayhemCommitment;

        if (value == bytes32(0)) {
            revert MissingCommitment();
        }

        if (
            block.number <=
            mayhemCommitBlock + 255
        ) revert RevealTooEarly();

        uint256 expiredBlock =
            mayhemCommitBlock;

        mayhemCommitment =
            bytes32(0);

        mayhemCommitBlock = 0;
        expiredCommitments++;

        emit MayhemCommitmentExpired(
            value,
            expiredBlock
        );
    }

    /// @notice Burns every unused Mayhem token after the immutable end
    /// condition. This is permissionless so a keeper or any user can finalize.
    function finalizeMayhem()
        external
        nonReentrant
    {
        if (
            launchMode ==
            LaunchMode.Classic
        ) revert ClassicMode();

        if (mayhemFinalized) {
            revert MayhemEnded();
        }

        if (!_endCondition()) {
            revert FinalizeNotReady();
        }

        uint256 burn =
            agentInventory;

        agentInventory = 0;
        mayhemFinalized = true;
        mayhemCommitment =
            bytes32(0);
        mayhemCommitBlock = 0;
        pendingManualRequest = false;

        if (burn != 0) {
            token.burnFromMarket(
                burn
            );
        }

        emit MayhemFinalized(
            burn,
            mayhemTradeCount,
            agentNativeIn,
            agentNativeOut
        );
    }

    function _quoteAgentBuy(
        uint256 input
    )
        private
        view
        returns (uint256 output)
    {
        if (input == 0) {
            revert InvalidAmount();
        }

        output = Math.mulDiv(
            tokenReserve,
            input,
            VIRTUAL_NATIVE +
                nativeReserve +
                input
        );

        if (
            output == 0 ||
            output >= tokenReserve
        ) revert Liquidity();
    }

    function _quoteAgentSell(
        uint256 input
    )
        private
        view
        returns (uint256 output)
    {
        if (
            input == 0 ||
            input > agentInventory
        ) revert InvalidAmount();

        output = Math.mulDiv(
            VIRTUAL_NATIVE +
                nativeReserve,
            input,
            tokenReserve + input
        );

        if (
            output == 0 ||
            output > nativeReserve
        ) revert Liquidity();
    }

    function _deadline(
        uint256 deadline,
        uint256 minimumOutput
    ) private view {
        if (minimumOutput == 0) {
            revert Slippage();
        }

        if (
            deadline < block.timestamp ||
            deadline >
                block.timestamp + 300
        ) revert Expired();
    }

    function _pay(
        address payable to,
        uint256 amount
    ) private {
        if (amount == 0) return;

        (bool success,) =
            to.call{value: amount}("");

        if (!success) {
            revert TransferFailed();
        }
    }
}