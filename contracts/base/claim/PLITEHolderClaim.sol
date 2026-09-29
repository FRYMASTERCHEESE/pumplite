// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Opt-in giveaway for the first 50 wallet addresses.
/// One wallet can claim exactly 1 token. This does not prove one human per wallet.
/// There is no owner, withdrawal, mutable amount, upgrade, or admin function.
contract PLITEHolderClaim {
    using SafeERC20 for IERC20;

    uint256 public constant CLAIM_AMOUNT = 1 ether;
    uint256 public constant MAX_CLAIMS = 50;

    IERC20 public immutable token;
    uint256 public claimCount;
    mapping(address => bool) public claimed;

    error InvalidToken();
    error AlreadyClaimed();
    error ClaimFinished();
    error InsufficientFunding();

    event Claimed(
        address indexed account,
        uint256 amount,
        uint256 claimNumber
    );

    constructor(address token_) {
        if (token_ == address(0)) revert InvalidToken();
        token = IERC20(token_);
    }

    function remainingClaims() external view returns (uint256) {
        return MAX_CLAIMS - claimCount;
    }

    function claim() external {
        if (claimed[msg.sender]) revert AlreadyClaimed();
        if (claimCount >= MAX_CLAIMS) revert ClaimFinished();
        if (token.balanceOf(address(this)) < CLAIM_AMOUNT) {
            revert InsufficientFunding();
        }

        claimed[msg.sender] = true;
        claimCount += 1;

        token.safeTransfer(msg.sender, CLAIM_AMOUNT);

        emit Claimed(
            msg.sender,
            CLAIM_AMOUNT,
            claimCount
        );
    }
}