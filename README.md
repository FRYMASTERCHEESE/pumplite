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

## Solana workspace

`programs/pumplite/src/lib.rs` is the Anchor program; `math.rs` contains pure checked arithmetic and unit tests.
The root Cargo workspace and Anchor configuration replace the previous misplaced root source file.
Anchor dependencies are pinned to 1.0.0; a compatible Rust/Agave build environment is required.

Host-only verification, without any wallet or network transactions:

```sh
cargo test --workspace
cargo check -p pumplite --features idl-build
```

Rust/Anchor/Agave were unavailable on the implementation host. These commands and the SBF build have **not** been verified there.
Generate and review a Cargo lockfile in that toolchain before release. Do not treat the current build identity as a deployed program.
A local SVM integration suite exercising token CPIs, constraints, rent, and rollback is still a release blocker.

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
