# PumpLite current status

Status date: 2 October 2026.

This file is the current operational-status reference. Documents such as IMPLEMENTATION_REPORT.md,
READINESS_FOLLOWUP.md, RELEASE_CANDIDATE.md, RELEASE_HANDOFF.md and LOCAL_READINESS_CLOSURE.md record
earlier verification checkpoints. Statements in those historical reports such as "not deployed",
"transactions disabled" or "no Mainnet wallet transaction" describe their checkpoint and do not
override this current status.

## Base Mainnet

PumpLite Base V2 is deployed and public writes are enabled.

- Chain: Base Mainnet (8453)
- Active V2 factory: `0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4`
- Contract version: 2
- Platform fee: 25 bps (0.25%)
- Mayhem support while active: 75 bps (0.75%) retained as real market backing
- PumpLite creation fee: 0%; Base network gas still applies
- Solana remains separately locked and undeployed

Base Mainnet wallet signing has been exercised with real user-approved operations. PLITE was created
on Base through the live PumpLite V2 deployment, and a separate PLITE/WETH Uniswap V2 liquidity
position was created with an explicit wallet approval. These facts do not imply that every wallet,
trade path, device, RPC failure or economic condition has been acceptance-tested.

## PLITE

- Token: `0xb15A460142c77b42cDF57815b0eeFEb24b593196`
- PumpLite V2 market: `0xa522A4Ef81fD31daec390ab46A32D4886e1461C7`
- Uniswap V2 PLITE/WETH pair: `0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086`
- First 50 PLITE claim: `0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2`
- Canonical Base WETH: `0x4200000000000000000000000000000000000006`

The First 50 PLITE claim is live on Base Mainnet. Its fixed reviewed rules allow up to 50 different wallet
addresses to claim exactly 1 PLITE each, once per address. The live on-chain claim count changes as claims occur.

The PumpLite bonding curve and the Uniswap V2 pool are separate markets. Curve backing/curve volume
must not include external DEX reserves, swaps or fees. The website reads the verified external pair
directly from Base for live reserves, reserve-ratio spot price and spot-implied pool liquidity.

## Frontend and market data

The public frontend supports Base wallet connection, token creation, market discovery, quotes,
wallet-signed transactions, confirmation checks and explorer links. Base market pages include bounded
on-chain history and rolling 24-hour curve activity reads. PLITE additionally displays live external
Uniswap V2 reserve data.

PumpLite must not fabricate prices, volume, trades, holders, liquidity or activity. A displayed DEX
spot price is a reserve ratio, not an execution guarantee or independent price oracle.

## Metadata

The public configuration has metadata uploads enabled. The frontend can normalize a selected token
image, request wallet-signed upload authorization, publish the image and metadata through the configured
PumpLite upload service, and use canonical IPFS URIs. The repository does not contain the provider's
private credentials and does not prove the current state or quota of external Cloudflare/Pinata services.

Published blockchain and IPFS information should be treated as public and potentially permanent.

## Security

The Base V2 contracts and frontend have automated, integration, adversarial and browser checks. Current
CI must remain green before a documentation or product update is treated as released.

PumpLite has not received an independent third-party smart-contract/economic audit. The controller wallet
and creators of tokens launched as mintable have documented roles. A mintable Base V2 creator can add
inventory only into that token's PumpLite market, only up to the immutable lifetime cap, until minting is
permanently locked. There is no arbitrary mint-to-wallet, owner reserve withdrawal, mutable treasury,
mutable platform fee, proxy upgrade, blacklist or pause function in Base V2.

## Legal and risk pages

The public site provides:

- Terms of Use: `terms.html`
- Privacy: `privacy.html`
- Risk Disclosure: `risk.html`

These pages describe non-custodial wallet use, fees, mintable-token behavior, metadata/IPFS publication,
external services and token/liquidity risks.

## Solana

The Solana program continues to be build/test material only for the public product configuration:
`programId=null` and `transactionsEnabled=false`. Passing Solana verification does not establish
a Solana Mainnet deployment.

Current-status note: the documents listed above are historical verification checkpoints and must be read at the commit and date they recorded.
## Read-only Base production verification

The repository includes `pnpm verify:base-production`. It validates the active Base V2 factory runtime and immutable roles, the reviewed PLITE market/token relationship, the official First 50 claim runtime/settings/backing, and the PLITE/WETH Uniswap V2 token identities and non-zero reserves directly from Base Mainnet. The verifier uses public RPC reads only: no wallet, signature, transaction, or ETH spend is used.
## Continuous Base production health

GitHub Actions now runs the read-only Base production verifier on relevant production changes, by manual dispatch, and on a daily schedule. The workflow has `contents: read` permission and does not load a wallet, request a signature, submit a transaction, or spend ETH. The check covers the live Base V2 factory, reviewed PLITE market/token, official First 50 claim backing, and PLITE/WETH Uniswap V2 pair identities/reserves.\n## Base mobile wallets\n\nPumpLite provides mobile browser handoff links for Phantom, Coinbase Wallet and MetaMask on Base. Phantom Ethereum injection is explicitly discovered alongside EIP-6963, Coinbase and MetaMask providers. Wallet access is still requested only after a user action, and transaction signing remains wallet-controlled. These compatibility paths are tested synthetically; they do not claim every phone/wallet version has been physically acceptance-tested.\n

## Live public-site health

The repository includes `pnpm verify:public-site` and a `Public site health` GitHub Actions workflow. The verifier checks that the live PumpLite Pages site matches the current checked-out public configuration and build references, including the home page, claim page, legal/risk pages, PLITE metadata, reviewed-token registry and static application assets. The workflow retries while Pages catches up after a relevant main-branch push and also runs daily. It is read-only and uses no wallet, signature, transaction or ETH.


## All-market Base invariant health

PumpLite now has a read-only verifier for every market registered by the active Base V2 factory. At a common Base block it checks reviewed runtime templates and market/token authority relationships, verifies that accounting reserves are backed by actual market balances, checks lifetime mint caps and permanent fixed-supply locks, and reconciles market burn accounting with token lifetime minted/current supply. The scheduled `Base market invariants` workflow is bounded to 250 markets by default so public RPC load cannot silently grow without an explicit capacity review.


## Base RPC redundancy health

PumpLite now checks the primary and fallback Base read RPC endpoints independently. The verifier requires every configured endpoint to identify Base Mainnet, report a recent block, read the active production contracts, and agree on key factory state at a common block. This complements the frontend's tested rate-limit/network fallback path: redundancy is considered degraded if either configured endpoint becomes unavailable or excessively stale rather than silently relying on only one provider.


## Base economic quote health

PumpLite now independently recomputes the live Base V2 bonding-curve quote math and compares it with each registered market's on-chain quote functions. The monitor verifies the fixed platform fee, Mayhem support rate, virtual-native pricing offset, initial Mayhem timing behavior and live manual/initial Mayhem state. Buy and sell probes are read-only calls at a common block and never submit transactions.


## Base write-path simulation health

PumpLite now performs live Base Mainnet `eth_call` simulations of important state-changing V2 paths without persisting any state. The monitor exercises valid fixed/mintable factory creation and invalid creation rejection, then checks controller/creator/token-market authority boundaries across every registered market. Authorized simulations are required to reach the expected live state path while unauthorized callers must fail. No wallet or transaction is used.


## Base event/accounting reconciliation

PumpLite now reconstructs live Base V2 accounting from the chain's own factory and market event history. The monitor checks that factory market order/configuration agrees with creation events and that event-derived reserves, volume, market support, burns, inventory minting, mint-lock state and manual Mayhem state reconcile with current contract/token state at the same Base block. Historical log requests are bounded and can split automatically for public RPC range limits.


## PLITE Uniswap V2 provenance health

PumpLite now independently verifies the external PLITE/WETH Uniswap V2 pool against the canonical Base Uniswap V2 factory. The monitor checks factory-to-pair and pair-to-factory provenance, exact PLITE/WETH token identities, live non-zero reserves, LP supply/minimum locked liquidity, the canonical PairCreated record and latest Sync-to-reserve consistency. This external DEX pool remains separate from PumpLite curve backing and its reserve-ratio price is not a guaranteed execution price or oracle.


## Metadata infrastructure health

PumpLite now monitors the live metadata authorization/upload service without creating a grant or publishing content. The health check verifies the Worker endpoint, capability negotiation, PumpLite-origin CORS restriction, configured image/JSON upload authorization gates, and challenge/issue service-binding availability through deliberately invalid fail-closed requests. This provides an operational signal for Cloudflare/service-binding configuration while keeping provider secrets server-side.


## Base privileged-action provenance

PumpLite now audits the historical transaction provenance for factory creation and Base V2 privileged actions. Creation transactions are matched to the event creator and active factory calldata. Controller-only Mayhem/support actions and creator-only inventory/lock actions are matched to each market's immutable roles, transaction sender/target, decoded function input, successful receipt and emitted event parameters. This is a read-only provenance check; it does not infer whether a wallet owner intended an action or whether a privileged wallet has been compromised.


## Base trade transaction provenance

PumpLite now audits the transaction provenance behind every recorded Base V2 Trade and BuyAndBurn event. The monitor matches transaction sender/target and decoded calldata to the event, verifies successful receipts, checks positive minimum-output and five-minute deadline constraints, independently checks the fixed fee arithmetic, and requires a matching ERC-20 transfer or burn movement in the same receipt. Trade types that have not occurred are explicitly reported as zero rather than inferred or fabricated.


## Production hardening Steps 19-27

A single read-only hardening bundle now covers nine additional production gates: First 50 claim history provenance, claim solvency, official Base/PLITE identity sealing, wallet-provider safety boundaries, pinned CI actions, dependency-lock discipline, legal/risk-page integrity, monitoring-mesh completeness and live critical-file parity. The bundle is exposed as `pnpm verify:hardening-19-27` and by the `Production hardening 19-27` scheduled/manual/push workflow. It uses no wallet, signature, transaction or ETH.

## Production hardening Steps 28-50

PumpLite now has a second bundled hardening verifier covering Steps 28 through 50. These checks are intentionally static/local for speed and determinism: they freeze critical Base/Solana/PLITE/claim identities and configuration, verify source-level economic and authority boundaries, preserve passive wallet discovery/mobile handoff protections, validate Pages/security-header publication rules, enforce exact dependency and GitHub Actions supply-chain controls, and require the complete production monitoring/release-readiness command and workflow mesh.

## Production hardening Steps 51-130

A fast static/local bundle now covers 80 additional production gates from Step 51 through Step 130. It verifies locked package/dependency state, active Base and locked Solana identities, PLITE/claim/DEX/registry consistency, Solidity authority/economic/supply protections, frontend wallet/metadata/RPC safety boundaries, Pages/security-header publication controls, CI supply-chain pinning and the complete monitoring/release mesh. The verifier is intentionally network-free and uses no wallet, signature, transaction or funds.
