# Architecture and accounting

## Shared economics

Let N be accounted real native reserves, T accounted vault token reserves, V the fixed native pricing offset,
A gross native buy input, and Q sell token input. All values are integers in smallest units.

Buy:
- fee = floor(A × 25 / 10,000)
- net = A − fee
- output = floor(T × net / (V + N + net))
- require 0 < output < T and output >= user minimum
- N increases by net; T decreases by output; fee is transferred to the fixed treasury

Sell:
- gross = floor((V + N) × Q / (T + Q))
- require 0 < gross <= N and T + Q <= initial supply
- fee = floor(gross × 25 / 10,000); output = gross − fee
- require output >= positive user minimum
- Q tokens are transferred back into the vault; N decreases by gross; T increases by Q
- output goes to seller and fee to treasury, atomically

Outputs round down, so (V + N) × T does not decrease through trades.
Small fees can round to zero, but output rounding must not create trader value.
Virtual native value is never included in spendable backing.
SOL amounts and token quantities are u64, intermediates are checked u128; volume is checked u128.
Solidity uses checked uint256 plus OpenZeppelin mulDiv for full-precision products.

The initial price and fee model require independent economic review.
There is no finite graduation or DEX migration. Rounding can leave tiny nonredeemable reserves.
External SPL burns can reduce circulating supply; the supply-distribution display measures tokens
that left original inventory, not an independently measured circulating-supply oracle.

## Actual funds versus accounted reserves

Without donations, actual native balance equals accounted reserves (plus rent on Solana),
and vault token balance equals tokenReserve.
Direct donations increase actual balances without increasing accounted reserves.
They do not move quotes, are never used as liquidity by this version, and cannot be rescued.
Before trades, actual balances must be at least the accounted amounts.
This intentionally avoids donation-driven price manipulation and avoids introducing withdrawal powers.

On Solana the program-owned market account holds SOL and preserves rent.
The canonical market ATA holds tokens. Account constraints bind mint, PDA, vault, trader ATA,
SPL Token program, signer, and the hardcoded treasury.
Mint authority is revoked atomically after inventory minting; freeze authority is never created.
Only legacy SPL Token is accepted; Token-2022 extensions are out of scope.

On Base each market owns its own non-upgradeable ERC-20 and native balance.
The factory registry determines which markets the website accepts.
A reentrancy guard protects both trade directions. Effects precede external calls; failures revert all state.
A rejecting treasury blocks fee-paying trades; it cannot redirect payments or take extra reserves.

## Client design

Static HTML/CSS plus a small ES module. No framework, CDN scripts, analytics, hosted fonts, or automatic media.
Ethers and Solana web3 are bundled locally into separate lazy-loaded chunks.
Base reads use a pinned block for a market snapshot. Solana market account reads return a confirmed slot.
Displayed observations have source block/slot and fetch time. Quotes have a 30-second review window.
On-chain minimum output and deadline remain authoritative even if reserves change after a quote.

Base checks chain 8453 for RPC and wallet; Solana checks the Mainnet genesis hash.
Wallet account changes invalidate quotes and require reconnection.
Sell approvals on Base authorize the exact amount, not an unlimited allowance.
Receipt status and Solana confirmation errors are checked before reporting confirmation.
Confirmation means the configured confirmation level, not irreversible finality.
A timeout can leave a submitted transaction unresolved: use its explorer link rather than assuming it failed.

Solana instruction/account serialization is intentionally compact and handwritten to avoid shipping Anchor.
It must be checked against generated IDL and exercised in a local SVM before enabling transactions.
No signing keys are handled by the application: only wallet-provider signing requests and public addresses.
