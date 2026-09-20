// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
interface IMarket {
    function buy(uint256 min, uint256 deadline) external payable returns (uint256);
    function sell(uint256 amount, uint256 min, uint256 deadline) external returns (uint256);
}
interface IToken { function approve(address spender, uint256 value) external returns (bool); function balanceOf(address account) external view returns (uint256); }
contract ReenterTrader {
    IMarket public market;
    bool public blocked;
    bool public rejectPayment;
    function enter(address market_) external payable {
        market = IMarket(market_); market.buy{value: msg.value}(1, block.timestamp + 100);
    }
    function exit(address token_, bool reject_) external {
        rejectPayment = reject_;
        uint256 amount = IToken(token_).balanceOf(address(this));
        IToken(token_).approve(address(market), amount);
        market.sell(amount, 1, block.timestamp + 100);
    }
    receive() external payable {
        require(!rejectPayment, "reject");
        (bool success,) = address(market).call(abi.encodeCall(IMarket.buy, (1, block.timestamp + 100)));
        blocked = !success;
    }
}
contract ForceDonation {
    constructor(address payable market) payable { selfdestruct(market); }
}
