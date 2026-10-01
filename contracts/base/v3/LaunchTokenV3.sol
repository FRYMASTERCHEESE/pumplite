// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice PumpLite V3 token.
/// @dev The market contract is the only mint/burn authority.
/// Classic launches mint only market inventory.
/// Mayhem launches additionally mint a segregated genesis inventory that
/// remains in market custody and is accounted to the Mayhem agent lane.
contract LaunchTokenV3 is ERC20 {
    address public immutable market;

    /// @notice Maximum lifetime inventory that the creator side of the
    /// market can ever mint, excluding the one-time Mayhem genesis inventory.
    uint256 public immutable marketSupplyCap;

    /// @notice One-time Mayhem inventory created at launch. Zero for Classic.
    uint256 public immutable mayhemGenesisSupply;

    /// @notice Compatibility/readability total cap. This equals
    /// marketSupplyCap + mayhemGenesisSupply.
    uint256 public immutable maxSupply;

    bool public immutable mintableAtLaunch;

    /// @notice Includes the one-time Mayhem genesis inventory.
    uint256 public totalMinted;

    /// @notice Tracks only creator/market-side lifetime minting.
    uint256 public totalMarketMinted;

    bool public mintingLocked;

    error OnlyMarket();
    error InvalidSupply();
    error InvalidAmount();
    error MintingDisabled();
    error SupplyCapExceeded();

    event SupplyMintedToMarket(
        uint256 amount,
        uint256 totalMarketMinted,
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
        uint256 initialMarketSupply_,
        uint256 marketSupplyCap_,
        uint256 mayhemGenesisSupply_,
        bool mintable_
    ) ERC20(name_, symbol_) {
        if (
            initialMarketSupply_ == 0 ||
            marketSupplyCap_ == 0 ||
            initialMarketSupply_ > marketSupplyCap_
        ) revert InvalidSupply();

        if (
            !mintable_ &&
            initialMarketSupply_ != marketSupplyCap_
        ) revert InvalidSupply();

        market = msg.sender;
        marketSupplyCap = marketSupplyCap_;
        mayhemGenesisSupply = mayhemGenesisSupply_;
        maxSupply = marketSupplyCap_ + mayhemGenesisSupply_;
        mintableAtLaunch = mintable_;
        mintingLocked = !mintable_;

        totalMarketMinted = initialMarketSupply_;
        totalMinted =
            initialMarketSupply_ +
            mayhemGenesisSupply_;

        // Both pools remain in market custody. Curve inventory and Mayhem
        // inventory are separated by CurveMarketV3 accounting.
        _mint(msg.sender, totalMinted);
    }

    function mintToMarket(uint256 amount)
        external
        onlyMarket
    {
        if (mintingLocked) revert MintingDisabled();
        if (amount == 0) revert InvalidAmount();

        uint256 newMarketMinted =
            totalMarketMinted + amount;

        if (newMarketMinted > marketSupplyCap) {
            revert SupplyCapExceeded();
        }

        totalMarketMinted = newMarketMinted;
        totalMinted += amount;

        _mint(market, amount);

        emit SupplyMintedToMarket(
            amount,
            newMarketMinted,
            totalSupply()
        );
    }

    function lockMintingForever()
        external
        onlyMarket
    {
        if (mintingLocked) revert MintingDisabled();

        mintingLocked = true;
        emit MintingPermanentlyLocked();
    }

    function burnFromMarket(uint256 amount)
        external
        onlyMarket
    {
        if (amount == 0) revert InvalidAmount();

        _burn(market, amount);

        emit MarketTokensBurned(
            amount,
            totalSupply()
        );
    }

    function remainingMintAllowance()
        external
        view
        returns (uint256)
    {
        if (mintingLocked) return 0;

        return
            marketSupplyCap -
            totalMarketMinted;
    }
}