# PumpLite — Base V2 Mainnet

A token launchpad targeting **Solana Mainnet and Base Mainnet**.
**Base Mainnet V2 is deployed and enabled for real transactions** through LaunchFactoryV2 `0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4`. V2 includes fixed or permanently capped mintable supply, Mayhem market support, Buy & Burn, and wallet-signed bonding-curve trading. **Solana Mainnet remains undeployed and transaction-locked.** Independent security/economic review remains appropriate for production financial software.
No admin panel, owner withdrawals, mutable fees, proxies, or market-edit controls are provided.

For the current live/deployment status, PLITE addresses, DEX pair, metadata state and historical-document boundary,
see [Current status](docs/CURRENT_STATUS.md).

## Run locally

Requirements: Node.js 22+ and pnpm 10.11.0.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm check
pnpm test
pnpm preview
```

Open http://127.0.0.1:4173. The preview binds only to loopback.
The initial page makes no blockchain requests; libraries are loaded only when needed.
Production configuration enables Base Mainnet V2 at `0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4` with `contractVersion=2` and `transactionsEnabled=true`. Solana remains locked with `programId=null` and `transactionsEnabled=false`.
There are deliberately no deployment scripts. Do not enable writes merely because tests pass.

Browser checks, with the preview running:

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

An installed browser can be selected with `BROWSER_EXECUTABLE`.
`PLAYWRIGHT_MODULE` optionally points to a host-provided Playwright module (use a file URL on Windows).

## GitHub Pages (repository root at /pumplite/)

The root `index.html` loads `./assets/app.js` and `./assets/styles.css`.
The `assets/` directory is generated **publication content** and must be versioned with the HTML.
Unlike ignored `dist/`, it is served directly when Pages publishes the repository root.
Never point the root HTML at `web/app.js`: the source adapters contain npm imports that require bundling.

```sh
pnpm build:pages
pnpm check:pages
pnpm test:pages
```

`build:pages` bundles the frontend only; it does not compile, deploy, or interact with contracts.
It uses the existing generated Base ABI. `pnpm build` still compiles contracts locally before building the frontend.
Both commands produce the same root assets and a matching ignored `dist/` preview.
`check:pages` rebuilds in memory and fails if the publishable assets are missing, stale or different.
CI runs this check before regenerating files on both Linux and Windows.

Use the pinned pnpm 10.11.0 and run `pnpm install --frozen-lockfile --ignore-scripts` before building.
The repository `.npmrc` pins `virtual-store-dir-max-length=60`: pnpm otherwise uses different
dependency folder names on Windows and Linux, which changes esbuild chunk hashes even when the
JavaScript is identical. Reinstall dependencies after changing this setting; do not bypass the freshness check.

All HTML links, configuration fetches and generated chunk imports are relative, so the project prefix
`/pumplite/` is retained. Hash routes need no server-side rewrite.
Solana and Base SDKs are bundled locally, loaded only on demand, and do not rely on a CDN or import map.
The root `.nojekyll` marker disables Jekyll processing for this static output
([GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site#static-site-generators)).

`test:pages` exports only root HTML, configuration, `.nojekyll` and generated assets into an isolated directory.
It serves those exact files at `/pumplite/` with ordinary static MIME types, no bundler, no npm resolution,
no source files and no SPA fallback. It tests mobile/desktop layout, both lazy SDK module graphs,
relative paths, configuration loading and hash-route reloads. Wallet methods and external network requests
are prohibited. It does not connect wallets or submit transactions.

When a future publication is explicitly approved, include `assets/`, `index.html` and `.nojekyll`
in the publishing branch. Running these build/test commands alone does not update the hosted site.

## Solana workspace

`programs/pumplite/src/lib.rs` is the Anchor program; `math.rs` contains pure checked arithmetic and unit tests.
The root Cargo workspace and Anchor configuration replace the previous misplaced root source file.
The verification toolchain is pinned to Rust 1.94.0, Anchor 1.0.2, Agave 3.1.10 and
SBF platform-tools v1.52 (bundled Rust 1.89.0-dev). Cargo.lock pins the resolved dependencies,
including the Anchor macro crates. The Anchor SPL interface/extension features are required by
Anchor's generated initialization code; the program still accepts only the legacy SPL Token program.

```sh
cargo fmt --all -- --check
cargo test --locked -p pumplite --lib
node scripts/build-solana.mjs
mkdir -p target/idl
anchor idl build --program-name pumplite --out target/idl/pumplite.json -- --locked
node scripts/check-solana-idl.mjs
PUMPLITE_SBF="$PWD/target/deploy/pumplite.so" cargo test --locked -p pumplite-svm-tests --features sbf-tests --test markets
```

The workflow in .github/workflows/solana.yml runs these checks on Ubuntu 24.04 without a wallet,
validator, RPC endpoint, deployment, or secrets. Downloads are versioned and checksum-verified.
The build wrapper prevents Agave from automatically generating a deployment keypair.
Anchor's required provider configuration names a deliberately nonexistent wallet path; verification never reads it.

Local Windows verification passed the SBF build, IDL generation/schema check, host tests and compiled-program
SVM integration tests. The GitHub-hosted Solana verification workflow is active and has passed on current Main.
A passing Solana build is not proof of a Solana Mainnet deployment.
See [test instructions](tests/solana/README.md) and the [exact verification report](docs/SOLANA_VERIFICATION.md).
The program identity remains build configuration only; transactions are still disabled.

## Base contracts

`contracts/base/v2/LaunchFactoryV2.sol` registers immutable V2 per-market deployments.
Each `CurveMarketV2` creates its own `LaunchTokenV2` with either fixed supply or a permanent lifetime mint cap. Mayhem can retain 0.75% of trade value as real market backing while active, alongside the fixed 0.25% platform fee. Buy & Burn purchases through the real curve and permanently burns the purchased market inventory.
Compilation uses pinned Solidity 0.8.30, the Shanghai EVM target, optimizer 200 runs, and OpenZeppelin 5.4.0.
V1 and V2 compiler evidence is kept separately under `build/base` and `build/base-v2`; the browser ABIs are `web/generated/base-abi.json` and `web/generated/base-v2-abi.json`.

`pnpm test` exercises deployed bytecode on a **process-local EVM test fixture**.
This is not a public test network, fork, Mainnet transaction, or product demo.
Test accounts exist only inside the in-memory provider; their signing material is never exported or persisted.

## Product rules

- Base V2 supports fixed / no-mint launches or mintable launches with an immutable lifetime cap.
- Base V2 initial and maximum supply must remain within the V2 contract bounds; mintable inventory can only be minted directly into the market.
- Mintable creators can permanently lock future minting.
- Fixed 25 bps (0.25%) platform fee is paid to the platform treasury.
- When Mayhem is active, an additional 75 bps (0.75%) is retained as real market backing rather than paid to the treasury.
- Initial Mayhem can be selected for the first 24 hours; after that window the configured Mayhem controller can switch it on or off.
- Buy & Burn spends real ETH through the bonding curve and permanently burns the purchased token inventory.
- Native pricing offset remains 1 ETH on Base. It is a pricing parameter, not withdrawable liquidity.
- Positive minimum output and a maximum five-minute on-chain deadline are required.
- No arbitrary owner withdrawal, mutable treasury, proxy upgrade, blacklist, or pause function exists in the V2 contracts.
- Launch creation still incurs network gas; PumpLite does not add a separate creation fee in the V2 factory.

Treasuries are public constants:

- Solana: `BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct`
- Base: `0x0de7fdcc798f7fac6b03b366c529133a9c60794d`

## Frontend boundaries

The frontend includes network selection, injected-wallet connection, creation, discovery, address-based market pages,
balance reads, integer quotes, slippage, signing/submission, confirmation checks, and explorer links.
With the current configuration it shows honest unavailable states rather than fabricated market activity.
Base Mainnet wallet signing has now been exercised with real user-approved transactions, including the live
PLITE launch and the separately approved PLITE/WETH Uniswap V2 liquidity position. This does not convert local
test fixtures into Mainnet tests and does not claim that every wallet, trade path or failure mode has been exercised.

Discovery reads actual accounts or factory registrations, eight markets at a time.
Solana key enumeration still scales with total market count; a bounded, verifiable indexer is needed for large deployments.
Base market pages now provide bounded on-chain trade history and rolling 24-hour curve reads, and the PLITE page reads
the verified Uniswap V2 PLITE/WETH pair directly from Base for reserves and reserve-ratio spot data. These are on-demand
chain reads, not a custodial market-data backend or a guaranteed oracle. Wallet-authorized token image/JSON publishing
is available through the configured metadata/IPFS service.

Solana name/symbol/URI are stored immutably in the market account. Metaplex wallet metadata is **not published yet**.
Base tokens expose standard ERC-20 names/symbols; optional metadata URI remains on the market.
Metadata URLs are not fetched automatically, avoiding untrusted downloads and mobile data use.
Base mobile handoff links are available for Phantom, Coinbase Wallet and MetaMask, with injected EVM-provider discovery inside compatible wallet browsers. WalletConnect is not implemented.

See [architecture](docs/ARCHITECTURE.md), [security and release gates](docs/SECURITY.md),
and [implementation/verification report](docs/IMPLEMENTATION_REPORT.md).
The root LICENSE is proprietary, Copyright © 2026 Corey Vibe, All Rights Reserved. Explicit file-level and third-party licenses remain unchanged.

See [the readiness follow-up](docs/READINESS_FOLLOWUP.md) for the Anchor security patch, expanded client/runtime coverage and current advisory results.

See [the current release-candidate verification](docs/RELEASE_CANDIDATE.md) for the final local gates, scoped dependency review, deployment prerequisites and full test/file inventories.

Latest readiness evidence and remaining operational gates: [Local readiness closure](docs/LOCAL_READINESS_CLOSURE.md).

## Read-only Base production verification

Run:

```sh
pnpm verify:base-production
```

This checks the active Base V2 factory, PLITE market/token, official First 50 claim, and PLITE/WETH Uniswap V2 pair directly against Base Mainnet. It uses public RPC reads only and does not load a wallet, request a signature, submit a transaction, or spend ETH.
## Continuous Base production health

`.github/workflows/base-production-health.yml` runs the read-only Base production verifier on relevant production changes, on manual dispatch, and once daily. The workflow has read-only repository permission, uses no wallet or signing secret, and submits no transaction. A failed run means the live Base state or a required public RPC read should be investigated; it does not authorize an automatic repair or transaction.

## Live public-site health

`pnpm verify:public-site` checks the deployed GitHub Pages site against the current repository state. It verifies the home page, First 50 claim page, Terms, Privacy and Risk pages, the public Base/Solana configuration, PLITE public metadata, reviewed-token registry, current application/claim bundles and stylesheet. The GitHub `Public site health` workflow retries while Pages catches up after relevant pushes and also runs daily. It uses public HTTPS reads only: no wallet, signing secret, transaction or ETH is used.


## All-market Base invariant health

`pnpm verify:base-markets` enumerates every market registered by the active Base V2 factory at one Base block and checks the deployed market/token runtime templates, immutable controller and treasury relationships, unique market/token identities, native and token reserve backing, lifetime mint caps, fixed-supply mint locks, remaining mint allowance and burn/supply accounting. The verifier is bounded by `PUMPLITE_MAX_MARKETS` so public RPC usage fails closed instead of silently becoming unbounded.

The `Base market invariants` GitHub workflow runs this read-only check after relevant production changes, manually, and daily. It uses no wallet, signing secret, transaction or ETH.
