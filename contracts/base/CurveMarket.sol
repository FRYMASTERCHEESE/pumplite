// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {LaunchToken} from "./LaunchToken.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Immutable constant-product market. Only accounted deposits back withdrawals.
/// Unsolicited ETH/token donations do not change quotes and cannot be rescued.
contract CurveMarket is ReentrancyGuard {
    uint256 public constant FEE_BPS = 25;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant VIRTUAL_NATIVE = 1 ether;
    address payable public constant TREASURY = payable(address(bytes20(hex"0de7fdcc798f7fac6b03b366c529133a9c60794d")));
    LaunchToken public immutable token;
    address public immutable creator;
    string public metadataURI;
    uint256 public nativeReserve;
    uint256 public tokenReserve = SUPPLY;
    uint256 public volume;

    error InvalidAmount();
    error Liquidity();
    error Slippage();
    error Expired();
    error TransferFailed();
    error Backing();
    event Trade(address indexed trader, bool indexed isBuy, uint256 input, uint256 output, uint256 fee);

    constructor(address creator_, string memory name_, string memory symbol_, string memory uri_) {
        creator = creator_;
        metadataURI = uri_;
        token = new LaunchToken(name_, symbol_, SUPPLY);
    }

    function quoteBuy(uint256 input) public view returns (uint256 output, uint256 fee) {
        if (input == 0) revert InvalidAmount();
        fee = Math.mulDiv(input, FEE_BPS, 10_000);
        uint256 net = input - fee;
        output = Math.mulDiv(tokenReserve, net, VIRTUAL_NATIVE + nativeReserve + net);
        if (output == 0 || output >= tokenReserve) revert Liquidity();
    }
    function quoteSell(uint256 input) public view returns (uint256 output, uint256 fee) {
        if (input == 0 || input > SUPPLY - tokenReserve) revert InvalidAmount();
        uint256 gross = Math.mulDiv(VIRTUAL_NATIVE + nativeReserve, input, tokenReserve + input);
        if (gross == 0 || gross > nativeReserve) revert Liquidity();
        fee = Math.mulDiv(gross, FEE_BPS, 10_000);
        output = gross - fee;
    }

    function buy(uint256 minimumOutput, uint256 deadline) external payable nonReentrant returns (uint256 output) {
        _deadline(deadline, minimumOutput);
        // msg.value is not yet part of accounted reserves.
        if (address(this).balance < nativeReserve + msg.value || token.balanceOf(address(this)) < tokenReserve) revert Backing();
        uint256 fee;
        (output, fee) = quoteBuy(msg.value);
        if (output < minimumOutput) revert Slippage();
        nativeReserve += msg.value - fee;
        tokenReserve -= output;
        volume += msg.value;
        if (!token.transfer(msg.sender, output)) revert TransferFailed();
        _pay(TREASURY, fee);
        emit Trade(msg.sender, true, msg.value, output, fee);
    }
    function sell(uint256 input, uint256 minimumOutput, uint256 deadline) external nonReentrant returns (uint256 output) {
        _deadline(deadline, minimumOutput);
        if (address(this).balance < nativeReserve || token.balanceOf(address(this)) < tokenReserve) revert Backing();
        uint256 fee;
        (output, fee) = quoteSell(input);
        if (output < minimumOutput) revert Slippage();
        uint256 gross = output + fee;
        nativeReserve -= gross;
        tokenReserve += input;
        volume += gross;
        if (!token.transferFrom(msg.sender, address(this), input)) revert TransferFailed();
        _pay(TREASURY, fee);
        _pay(payable(msg.sender), output);
        emit Trade(msg.sender, false, input, output, fee);
    }
    function _deadline(uint256 deadline, uint256 minimum) private view {
        if (minimum == 0) revert Slippage();
        if (deadline < block.timestamp || deadline > block.timestamp + 300) revert Expired();
    }
    function _pay(address payable to, uint256 amount) private {
        if (amount == 0) return;
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
