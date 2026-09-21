# PumpLite — local implementation

A lightweight fixed-supply token launchpad targeting **Solana Mainnet and Base Mainnet**.
This checkout is **not deployed, audited, or enabled for real transactions**.
No admin panel, owner withdrawals, mutable fees, proxies, or market-edit controls are provided.

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
Both deployment addresses are null and `transactionsEnabled` is false in `config.json`.
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
The verification toolchain is pinned to Rust 1.94.0, Anchor 1.0.0, Agave 3.1.10 and
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

Local Windows verification passed the SBF build, IDL generation/schema check, 4 host tests and 21 compiled-program
SVM integration tests. The GitHub-hosted workflow has not been run. A passing build is not Mainnet approval.
See [test instructions](tests/solana/README.md) and the [exact verification report](docs/SOLANA_VERIFICATION.md).
The program identity remains build configuration only; transactions are still disabled.

## Base contracts

`contracts/base/LaunchFactory.sol` registers immutable per-market deployments.
Each `CurveMarket` creates its own fixed-supply `LaunchToken`.
Compilation uses pinned Solidity 0.8.30, the Shanghai EVM target, optimizer 200 runs, and OpenZeppelin 5.4.0.
The compiler writes ignored local artifacts to `build/base` and deterministic browser ABIs to `web/generated/base-abi.json`.

`pnpm test` exercises deployed bytecode on a **process-local EVM test fixture**.
This is not a public test network, fork, Mainnet transaction, or product demo.
Test accounts exist only inside the in-memory provider; their signing material is never exported or persisted.

## Product rules

- 1 billion tokens per launch. Solana: 6 decimals; Base: 18 decimals. All arithmetic uses raw units.
- No creator allocation. Entire supply enters the vault. No additional minting or freezing.
- Fixed 25 bps (0.25%) fee, entirely paid to the platform treasury. No referral/creator fee split.
- Native pricing offset: 30 SOL or 1 ETH. These are economic design parameters, **not real liquidity**.
- Buys deposit net native currency and receive vault tokens; sells return tokens and receive only backed native currency.
- Positive minimum output and a maximum five-minute on-chain deadline are required.
- No graduation, migration, arbitrary withdrawal, pause, mutable market settings, or recovery of direct donations.
- Launch creation charges network/account-creation costs, but no separate platform creation fee.

Treasuries are public constants:

- Solana: `BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct`
- Base: `0x0de7fdcc798f7fac6b03b366c529133a9c60794d`

## Frontend boundaries

The frontend includes network selection, injected-wallet connection, creation, discovery, address-based market pages,
balance reads, integer quotes, slippage, signing/submission, confirmation checks, and explorer links.
With the current configuration it shows honest unavailable states rather than fabricated market activity.
No wallet signing flow was exercised against Mainnet.

Discovery reads actual accounts or factory registrations, eight markets at a time.
Solana key enumeration still scales with total market count; a bounded, verifiable indexer is needed for large deployments.
There is no continuous chart/history service, external price feed, automatic polling, image upload, or custodial backend.

Solana name/symbol/URI are stored immutably in the market account. Metaplex wallet metadata is **not published yet**.
Base tokens expose standard ERC-20 names/symbols; optional metadata URI remains on the market.
Metadata URLs are not fetched automatically, avoiding untrusted downloads and mobile data use.
Mobile support currently means an injected-wallet browser, not WalletConnect or mobile deep-link handoff.

See [architecture](docs/ARCHITECTURE.md), [security and release gates](docs/SECURITY.md),
and [implementation/verification report](docs/IMPLEMENTATION_REPORT.md).
The inherited root LICENSE is still a placeholder; project-wide licensing must be resolved before publication.
