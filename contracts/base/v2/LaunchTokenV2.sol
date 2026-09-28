// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice PumpLite V2 launch token.
/// The market contract is the only mint/burn authority.
/// There is no owner, tax, blacklist, pause, upgrade, or arbitrary mint-to-wallet function.
contract LaunchTokenV2 is ERC20 {
    address public immutable market;
    uint256 public immutable maxSupply;
    bool public immutable mintableAtLaunch;

    uint256 public totalMinted;
    bool public mintingLocked;

    error OnlyMarket();
    error InvalidSupply();
    error InvalidAmount();
    error MintingDisabled();
    error SupplyCapExceeded();

    event SupplyMintedToMarket(
        uint256 amount,
        uint256 totalMinted,
        uint256 currentSupply
    );

    event MarketTokensBurned(
        uint256 amount,
        uint256 currentSupply
    );

    event MintingPermanentlyLocked();

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        uint256 maxSupply_,
        bool mintable_
    ) ERC20(name_, symbol_) {
        if (
            initialSupply_ == 0 ||
            maxSupply_ == 0 ||
            initialSupply_ > maxSupply_
        ) revert InvalidSupply();

        // Fixed / No Mint tokens must start at their final supply.
        if (!mintable_ && initialSupply_ != maxSupply_) {
            revert InvalidSupply();
        }

        market = msg.sender;
        maxSupply = maxSupply_;
        mintableAtLaunch = mintable_;
        mintingLocked = !mintable_;
        totalMinted = initialSupply_;

        _mint(msg.sender, initialSupply_);
    }

    /// @notice Mint additional inventory directly into the PumpLite market.
    /// Burned tokens never restore mint allowance.
    function mintToMarket(uint256 amount) external onlyMarket {
        if (mintingLocked) revert MintingDisabled();
        if (amount == 0) revert InvalidAmount();

        uint256 newLifetimeMinted = totalMinted + amount;
        if (newLifetimeMinted > maxSupply) revert SupplyCapExceeded();

        totalMinted = newLifetimeMinted;
        _mint(market, amount);

        emit SupplyMintedToMarket(
            amount,
            newLifetimeMinted,
            totalSupply()
        );
    }

    /// @notice Permanently disables all future minting.
    function lockMintingForever() external onlyMarket {
        if (mintingLocked) revert MintingDisabled();

        mintingLocked = true;
        emit MintingPermanentlyLocked();
    }

    /// @notice Burns token inventory held by the market.
    /// Used later by PumpLite's Buy & Burn flow.
    function burnFromMarket(uint256 amount) external onlyMarket {
        if (amount == 0) revert InvalidAmount();

        _burn(market, amount);

        emit MarketTokensBurned(amount, totalSupply());
    }

    function remainingMintAllowance() external view returns (uint256) {
        if (mintingLocked) return 0;
        return maxSupply - totalMinted;
    }
}
