// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CurveMarketV2} from "./CurveMarketV2.sol";

/// @notice PumpLite V2 permissionless factory.
/// Existing PumpLite V1 contracts are completely separate and unchanged.
contract LaunchFactoryV2 {
    uint256 public constant MIN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000_000 ether;

    address public immutable mayhemController;
    address payable public immutable treasury;

    address[] public markets;
    mapping(address => bool) public isMarket;

    error InvalidAddress();
    error InvalidMetadata();
    error InvalidSupply();

    event MarketCreatedV2(
        address indexed market,
        address indexed token,
        address indexed creator,
        string name,
        string symbol
    );

    event MarketConfigV2(
        address indexed market,
        uint256 initialSupply,
        uint256 maxSupply,
        bool mintable,
        bool initialMayhem
    );

    constructor(
        address mayhemController_,
        address payable treasury_
    ) {
        if (
            mayhemController_ == address(0) ||
            treasury_ == address(0)
        ) revert InvalidAddress();

        mayhemController = mayhemController_;
        treasury = treasury_;
    }

    function marketCount()
        external
        view
        returns (uint256)
    {
        return markets.length;
    }

    function createMarketV2(
        CurveMarketV2.LaunchConfig calldata config
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
            config.initialSupply < MIN_SUPPLY ||
            config.initialSupply > config.maxSupply ||
            config.maxSupply > MAX_SUPPLY
        ) revert InvalidSupply();

        if (
            !config.mintable &&
            config.initialSupply != config.maxSupply
        ) revert InvalidSupply();

        CurveMarketV2 market = new CurveMarketV2(
            msg.sender,
            mayhemController,
            treasury,
            config
        );

        address marketAddress = address(market);

        markets.push(marketAddress);
        isMarket[marketAddress] = true;

        emit MarketCreatedV2(
            marketAddress,
            address(market.token()),
            msg.sender,
            config.name,
            config.symbol
        );

        emit MarketConfigV2(
            marketAddress,
            config.initialSupply,
            config.maxSupply,
            config.mintable,
            config.initialMayhem
        );

        return marketAddress;
    }

    function _validateMetadata(
        string calldata name,
        string calldata symbol,
        string calldata uri
    ) private pure {
        bytes memory nameBytes = bytes(name);
        bytes memory symbolBytes = bytes(symbol);
        bytes memory uriBytes = bytes(uri);

        if (
            nameBytes.length == 0 ||
            nameBytes.length > 32 ||
            symbolBytes.length == 0 ||
            symbolBytes.length > 10 ||
            uriBytes.length > 200
        ) revert InvalidMetadata();

        bool nonSpace;

        for (uint256 i; i < nameBytes.length; ++i) {
            if (nameBytes[i] != 0x20) {
                nonSpace = true;
                break;
            }
        }

        if (!nonSpace) revert InvalidMetadata();

        for (uint256 i; i < symbolBytes.length; ++i) {
            bytes1 c = symbolBytes[i];

            bool valid =
                (c >= 0x41 && c <= 0x5a) ||
                (c >= 0x30 && c <= 0x39);

            if (!valid) revert InvalidMetadata();
        }

        if (
            uriBytes.length != 0 &&
            !_prefix(uriBytes, bytes("https://")) &&
            !_prefix(uriBytes, bytes("ipfs://"))
        ) revert InvalidMetadata();
    }

    function _prefix(
        bytes memory value,
        bytes memory prefix
    ) private pure returns (bool) {
        if (value.length < prefix.length) return false;

        for (uint256 i; i < prefix.length; ++i) {
            if (value[i] != prefix[i]) return false;
        }

        return true;
    }
}
