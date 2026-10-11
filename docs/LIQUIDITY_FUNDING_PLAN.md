# PumpLite liquidity funding plan — new coins + PLITE

This plan does **not** impose a mandatory creation charge or capture launch proceeds. The current PumpLite creation fee remains **0%**, and no contract, smart-account authority, secret, Worker, pool reserve, or wallet balance is modified by the funding planner.

## Implemented, user-accessible, no-wallet interface

- `/pumplite/liquidity.html`: separately review intended (a) ETH or SOL first purchases for the new coin's **PumpLite bonding curve**, and (b) matching **PLITE + WETH** liquidity for the existing Uniswap V2 pool on **Base**. Input validation supports 18/9 decimals and fails closed on incomplete PLITE/WETH pair entries. Amounts and plan are never saved, transmitted, signed, invoiced, or treated as on-chain receipts.
- New coin creator page: explains before approval how the separate funding routes work, with a link to the planner. The existing Base optional first buy can add actual ETH to the new coin's on-chain bonding curve **only after the creator separately approves the buy**. On Solana Classic, creation is **create-only**; the user must separately buy from the new coin's market after the mint exists. Solana Manual Mayhem has a separately reviewed creator-activation purchase requirement.
- PLITE market panel: links to this plan and to the **existing** Uniswap V2 PLITE/WETH pool, at `0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086`; official token `0xb15A460142c77b42cDF57815b0eeFEb24b593196`, quote token Base WETH `0x4200000000000000000000000000000000000006`.
- Actual liquidity contributions take place through the existing owner-controlled trading flow or independently via the official `app.uniswap.org` pool interface. Both paths require user-signed transactions. We do not auto-add liquidity after someone creates a coin, invoke wallets in the background, fabricate reserves, or report planning amounts as funded.
- PLITE liquidity is **separate** from any PumpLite market's bonding-curve backing, even for PLITE itself. A bigger quoted market cap does not prove deeper market liquidity, and no swap price or redemption guarantee is implied.

## Optional transaction route and risk requirements

**Base new coin**
1. Creator enters desired optional first-buy amount in the existing Create dialog.
2. Creator reviews the actual coin creation transaction and Base gas in wallet; the market is created only after wallet confirmation.
3. Creator separately reviews the optional buy transaction and its SOL/ETH amount, fees, minimum output and slippage. A positive buy deposits real native ETH backing to the PumpLite market according to the deployed contract's reserve accounting. Creation without a buy adds no new ETH backing.
4. Confirm the transaction from an on-chain receipt, never from a draft or an intent flag. If coin creation succeeds but buy fails, do not repeat create blindly.

**Solana Classic new coin**
1. Creator signs the real mint creation transaction, subject to rent/fees. No automatic first buy.
2. After confirmation, creator opens the market and separately approves a SOL buy, which increases verified on-chain backing subject to fees.
3. Never claim the mint event funded the market or guarantee any subsequent purchase.

**PLITE / WETH Uniswap V2 LP**
1. User owns both tokens on Base and understands price-impact, custody, impermanent-loss, thin pool and liquidity/LP token ownership risks.
2. User navigates the canonical official existing pool on Uniswap. Verify **the two token addresses, correct chain, pool address and current reserve ratio**. Do **not** send tokens directly to the pair contract; use the vetted Uniswap interface.
3. The provider shows the real matched amounts, approvals, slippage/gas estimates and the transaction to confirm. The user may decline.
4. Confirm after finality via the pair's ERC-20 reserves and liquidity token mint receipt. LP ownership is not a lock: LP tokens generally permit removing that liquidity later.

## Future automation gate — not built and not authorized

The user also wants some benefits for PLITE **whenever another PumpLite coin is launched**. There is presently no legitimate automatic funding source: creations charge 0%, creator transaction/network fees are not platform revenue, trading fees may be contract-bound, and no audited funds splitter exists. There is no undisclosed payment redirect.

To automate any PLITE pool funding legally and safely:
1. Define separate, **explicit opt-in** funding allocations with a clear creator-readable maximum denominated in chain-native currency and a way to opt out. Solana and Base cannot be treated as fungible without a reviewed cross-chain settlement/bridging solution.
2. Specify asset sources: optional creator contributions from existing wallets **or** legitimately available treasury funds, with wallet owner authorization and no claim that 0%-fee launches generate money.
3. Design independent custody-minimizing, professionally reviewed EVM transactions for the actual PLITE/WETH ratio/LP mint and a reviewed Solana funding path if needed. No open-ended token allowance or undocumented router interactions. The pool LP tokens must have disclosed owner, ability to withdraw or explicit on-chain lock.
4. Require idempotent receipts, public per-contribution accounting, slippage limits, budget caps, chain/network assertions, independent security/economic audit, adverse tests, refund/failure recovery, logging and user confirmations.
5. Obtain separate explicit approval for **any** new contract deployment, fee changes, treasury transfers, token trades, signing keys and wallet spending, before production. Do not automate repeated launches, background wallet signing, fake holder generation or fake liquidity data.

## Verification and provenance

Static tests: `tests/liquidity-plan.test.mjs`. Browser checks: `tests/community-browser.mjs` (390px mobile and 1440px desktop). Production source/public exact parity: `scripts/verify-public-site.mjs`. The repo's contract and CI checks must still pass unchanged. This code contains **no signer** and **no network call**, so it cannot create or fund a token or pool merely by opening a page.

Official Uniswap guidance:
- https://support.uniswap.org/hc/en-us/articles/20915582427917-How-to-add-a-new-liquidity-position-to-Uniswap-v2
- https://support.uniswap.org/hc/en-us/articles/20903989864205-How-to-provide-liquidity-on-the-Base-Network

## Consent-gated handoff automation (phase 2)

PumpLite's `/liquidity.html` now generates an opt-in **Continue with automatic launch setup** link for a planned first buy of **up to 1 ETH or 1 SOL**. The link carries only chain and intended native asset amount in the URL; it does not contain secrets, wallet credentials, signatures or payment authorizations. Larger amounts require the normal manual workflow.

The creator page `/?page=create&liquidityChain=base|solana&liquidityBuy=<amount>` uses the separate `launch-automation.js` helper. It only reads and validates these **untrusted** parameters, waits for the existing wallet application to finish its read-only boot, then offers an explicit **Use planned buy amount** action. Nothing is armed by a URL alone. **Skip** disables the intended amount immediately. Changing the chain also clears the opt-in.

- **Base:** after the user opts in, the helper pre-fills the amount in PumpLite's EXISTING optional first ETH buy dialog. It waits until the wallet application finishes its busy state and releases the input; otherwise it leaves the input untouched. It does not submit the form, create a token, purchase tokens, request connection or alter the on-chain quote. The user can edit the amount or choose zero before signing creation and then the separate buy.
- **Solana Classic:** the deployed creator remains create-only. After the user opts in and deliberately finishes real mint creation, the helper can prepare the selected SOL amount in the new market's existing Buy input. It **does not request a quote, invoke Buy, connect Phantom or sign a transaction**. The user must review the exact mint, quote, slippage and wallet authorization.
- **PLITE Uniswap V2:** remains a **separate opt-in contribution** of matching PLITE and WETH. The official existing pair link is supplied on the planner, and the user funds via Uniswap's reviewed interface only after separate approvals. No automatic LP token mint/lock or launch fee splitter has been authorized, designed or deployed.

The standalone helper explicitly contains no wallet signing API, `fetch`, cross-origin requests, storage, automated button click or delayed transaction timer. Malformed amounts, negative amounts, wrong networks and intents above 1 native token are rejected. A blockchain signature is **never** triggered by page load.

For full on-chain LP automation, define the exact amount/payer and custody model first, independently audit an allowance-bounded Uniswap interaction and its failure/idempotency handling, and obtain additional explicit owner approval before any spending, contract upgrades or changes to the 0% creator fee.
