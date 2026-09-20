// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {CurveMarket} from "./CurveMarket.sol";

/// @notice Permissionless registry; no owner, upgrade mechanism or mutable settings.
contract LaunchFactory {
    address[] public markets;
    mapping(address => bool) public isMarket;
    event MarketCreated(address indexed market, address indexed token, address indexed creator, string name, string symbol);
    error Metadata();
    function marketCount() external view returns (uint256) { return markets.length; }
    function createMarket(string calldata name, string calldata symbol, string calldata uri) external returns (address) {
        if (bytes(name).length == 0 || bytes(name).length > 32 || bytes(symbol).length == 0 ||
            bytes(symbol).length > 10 || bytes(uri).length > 200) revert Metadata();
        bool nonSpace;
        for (uint256 i; i < bytes(name).length; ++i) if (bytes(name)[i] != 0x20) nonSpace = true;
        if (!nonSpace) revert Metadata();
        for (uint256 i; i < bytes(symbol).length; ++i) {
            bytes1 c = bytes(symbol)[i];
            if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39))) revert Metadata();
        }
        if (bytes(uri).length != 0 && !_prefix(bytes(uri), bytes("https://")) && !_prefix(bytes(uri), bytes("ipfs://"))) revert Metadata();
        CurveMarket market = new CurveMarket(msg.sender, name, symbol, uri);
        address id = address(market);
        markets.push(id);
        isMarket[id] = true;
        emit MarketCreated(id, address(market.token()), msg.sender, name, symbol);
        return id;
    }
    function _prefix(bytes memory value, bytes memory prefix) private pure returns (bool) {
        if (value.length < prefix.length) return false;
        for (uint256 i; i < prefix.length; ++i) if (value[i] != prefix[i]) return false;
        return true;
    }
}
