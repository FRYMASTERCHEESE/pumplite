// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CurveMarketV3} from "./CurveMarketV3.sol";

/// @notice PumpLite V3 permissionless factory.
/// V1 and V2 deployments remain completely separate and unchanged.
contract LaunchFactoryV3 {
    uint256 public constant MIN_SUPPLY =
        1_000_000_000 ether;

    uint256 public constant MAX_SUPPLY =
        1_000_000_000_000_000 ether;

    address public immutable mayhemController;
    address payable public immutable treasury;
    address payable public immutable mayhemFeeTreasury;

    CurveMarketV3.MayhemLimits public mayhemLimits;

    address[] public markets;
    mapping(address => bool) public isMarket;

    error InvalidAddress();
    error InvalidMetadata();
    error InvalidSupply();
    error InvalidLaunchMode();
    error InvalidMayhemLimits();

    event MarketCreatedV3(
        address indexed market,
        address indexed token,
        address indexed creator,
        string name,
        string symbol
    );

    event MarketConfigV3(
        address indexed market,
        uint256 initialSupply,
        uint256 maxSupply,
        bool mintable,
        uint8 launchMode,
        uint256 mayhemGenesisSupply
    );

    constructor(
        address mayhemController_,
        address payable treasury_,
        address payable mayhemFeeTreasury_,
        CurveMarketV3.MayhemLimits memory limits_
    ) {
        if (
            mayhemController_ == address(0) ||
            treasury_ == address(0) ||
            mayhemFeeTreasury_ == address(0)
        ) revert InvalidAddress();

        _validateLimits(limits_);

        mayhemController =
            mayhemController_;

        treasury = treasury_;

        mayhemFeeTreasury =
            mayhemFeeTreasury_;

        mayhemLimits = limits_;
    }

    function marketCount()
        external
        view
        returns (uint256)
    {
        return markets.length;
    }

    function createMarketV3(
        CurveMarketV3.LaunchConfig calldata config
    )
        external
        returns (address)
    {
        _validateMetadata(
            config.name,
            config.symbol,
            config.uri
        );

        if (
            config.initialSupply <
                MIN_SUPPLY ||
            config.initialSupply >
                config.maxSupply ||
            config.maxSupply >
                MAX_SUPPLY
        ) revert InvalidSupply();

        if (
            !config.mintable &&
            config.initialSupply !=
                config.maxSupply
        ) revert InvalidSupply();

        if (
            config.launchMode >
            uint8(
                CurveMarketV3
                    .LaunchMode
                    .MayhemManual
            )
        ) revert InvalidLaunchMode();

        CurveMarketV3 market =
            new CurveMarketV3(
                msg.sender,
                mayhemController,
                treasury,
                mayhemFeeTreasury,
                mayhemLimits,
                config
            );

        address marketAddress =
            address(market);

        markets.push(marketAddress);

        isMarket[marketAddress] =
            true;

        emit MarketCreatedV3(
            marketAddress,
            address(market.token()),
            msg.sender,
            config.name,
            config.symbol
        );

        emit MarketConfigV3(
            marketAddress,
            config.initialSupply,
            config.maxSupply,
            config.mintable,
            config.launchMode,
            config.launchMode == 0
                ? 0
                : config.initialSupply
        );

        return marketAddress;
    }

    function _validateLimits(
        CurveMarketV3.MayhemLimits
            memory value
    ) private pure {
        if (
            value.minBuy == 0 ||
            value.maxBuy <
                value.minBuy ||
            value.maxTotalBuy <
                value.maxBuy ||
            value.maxTotalSell == 0 ||
            value.maxTrades == 0 ||
            value.minSellBps == 0 ||
            value.maxSellBps <
                value.minSellBps ||
            value.maxSellBps >
                10_000 ||
            value.minInterval >
                1 hours
        ) revert InvalidMayhemLimits();
    }

    function _validateMetadata(
        string calldata name,
        string calldata symbol,
        string calldata uri
    ) private pure {
        bytes memory nameBytes =
            bytes(name);

        bytes memory symbolBytes =
            bytes(symbol);

        bytes memory uriBytes =
            bytes(uri);

        if (
            nameBytes.length == 0 ||
            nameBytes.length > 32 ||
            symbolBytes.length == 0 ||
            symbolBytes.length > 10 ||
            uriBytes.length > 200
        ) revert InvalidMetadata();

        bool nonSpace;

        for (
            uint256 i;
            i < nameBytes.length;
            ++i
        ) {
            if (
                nameBytes[i] != 0x20
            ) {
                nonSpace = true;
                break;
            }
        }

        if (!nonSpace) {
            revert InvalidMetadata();
        }

        for (
            uint256 i;
            i < symbolBytes.length;
            ++i
        ) {
            bytes1 c =
                symbolBytes[i];

            bool valid =
                (
                    c >= 0x41 &&
                    c <= 0x5a
                ) ||
                (
                    c >= 0x30 &&
                    c <= 0x39
                );

            if (!valid) {
                revert InvalidMetadata();
            }
        }

        if (
            uriBytes.length != 0 &&
            !_prefix(
                uriBytes,
                bytes("https://")
            ) &&
            !_prefix(
                uriBytes,
                bytes("ipfs://")
            )
        ) revert InvalidMetadata();
    }

    function _prefix(
        bytes memory value,
        bytes memory prefix
    ) private pure returns (bool) {
        if (
            value.length <
            prefix.length
        ) return false;

        for (
            uint256 i;
            i < prefix.length;
            ++i
        ) {
            if (
                value[i] !=
                prefix[i]
            ) return false;
        }

        return true;
    }
}