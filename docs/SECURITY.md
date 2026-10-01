# Security boundaries and current release gates

Status date: 1 October 2026.

PumpLite Base V2 is deployed and enabled for real transactions at
`0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4`. The older Base V1 factory at `0xf722BeD94c4A41B2C71cDCDEB5EEA062352aEe44`
is separate and is not the active public V2 factory. Solana Mainnet remains undeployed and
transaction-locked.

PumpLite has not received an independent third-party smart-contract/economic audit. Automated,
integration, adversarial and browser testing reduces known implementation risk but is not a substitute
for an independent audit.

## Base V2 privilege boundaries

Base V2 deliberately has no arbitrary owner reserve withdrawal, mutable treasury, mutable platform fee,
proxy upgrade, blacklist or pause function.

The important privileged roles that do exist are explicit:

- The fixed Mayhem controller can switch manual Mayhem after the initial 24-hour window and can call
  market support with real ETH.
- A creator who launched a token as mintable can call market inventory minting up to that token's
  immutable lifetime maximum until minting is permanently locked.
- Newly minted inventory goes directly to the token's PumpLite market; there is no arbitrary
  creator mint-to-wallet function.
- Fixed / No Mint launches start with their final supply and cannot later enable minting.

The token market contract is the token's mint/burn authority. Burned tokens do not restore lifetime
mint allowance.

## Funds and transaction safety

Base V2 trade paths use reentrancy protection, positive minimum output, a maximum five-minute
on-chain deadline and checked reserve/backing conditions. The 25 bps platform fee is routed to the
immutable treasury. When Mayhem is active, the additional 75 bps support amount stays in the market
as real backing rather than being paid to the treasury.

Wallet approval is always required for transactions. Never request, export, log, store or commit seed
phrases or private keys. Public treasury, token, market and pair addresses are intentionally public.
No wallet credentials are required by CI.

## Current live boundaries

Base Mainnet writes are enabled with contractVersion=2. Solana remains fail-closed with
`programId=null` and `transactionsEnabled=false`.

Real user-approved Base wallet operations have occurred, including the PLITE launch and a separately
approved PLITE/WETH Uniswap V2 liquidity position. Local EVM and browser tests remain local tests and
must not be described as live-chain acceptance.

The external Uniswap V2 pool is not PumpLite curve backing. Its reserves and reserve-ratio price can
change independently. Very small external liquidity can create extreme slippage.

## Data integrity

Do not hardcode or fabricate balances, prices, volume, trades, holders or liquidity.

Base market reads are chain-derived. Rolling 24-hour activity and chart/history reads are bounded to
protect public RPC capacity. The PLITE external-liquidity card reads the verified PLITE/WETH V2 pair
directly from Base.

User-controlled text must remain rendered as inert text. Remote creator metadata is not automatically
executed or injected into the DOM.

## Metadata publication

The public frontend can use wallet-signed authorization for image/metadata publishing through the
configured PumpLite upload service. The browser does not receive Pinata or infrastructure secrets.
Images are normalized and bounded before upload. Published IPFS content is public and may be difficult
or impossible to erase everywhere.

External provider credentials, quotas and Cloudflare/Pinata runtime state are operational concerns and
cannot be proven by repository tests alone.

## CI and release checks

The current GitHub workflows run local/frontend/Base verification, Pages deployment checks and Solana
build/runtime verification. A green CI run establishes only the checks it actually executes.

For significant public funds, remaining security work includes:

1. Obtain an independent smart-contract/economic/frontend review and resolve material findings.
2. Keep the controller/treasury wallet secure and verify immutable addresses before approving actions.
3. Continue adversarial/stateful testing for edge cases, MEV, slippage, tiny-trade rounding and long sequences.
4. Monitor public RPC capacity, metadata infrastructure and GitHub Pages availability.
5. Re-run the complete release checks after any contract, transaction, wallet, RPC or metadata change.
6. Keep Solana transaction-locked until a separate deployment, authority and acceptance process is explicitly approved.

## Historical reports

IMPLEMENTATION_REPORT.md, READINESS_FOLLOWUP.md, RELEASE_CANDIDATE.md, RELEASE_HANDOFF.md and
LOCAL_READINESS_CLOSURE.md are retained as historical verification records. Their old deployment-state
statements must be interpreted at the date/commit they recorded. See CURRENT_STATUS.md for current state.

## Base production health workflow

The `Base production health` GitHub Actions workflow runs the public read-only production verifier on relevant production changes, manual dispatch, and a daily schedule. It is intentionally configured with repository `contents: read` permission and no signing secret. The workflow can report a problem but cannot repair contracts, move funds, deploy, or submit a transaction.

## Public-site health verification

The `Public site health` workflow performs public HTTPS reads against the live PumpLite Pages origin and compares critical JSON/configuration and asset references with the checked-out commit. It has repository `contents: read` permission, no secrets and no wallet capability. This catches stale or missing public site files but does not turn GitHub Pages into a full security-header-capable production proxy and does not replace independent security review.
