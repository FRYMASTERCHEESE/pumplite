# Local implementation report

Date: 2026-09-20. This report describes the original local implementation work.

**Solana verification update (2026-09-21):** later build/test results supersede the original
Solana-unverified notes below. See [Solana verification](SOLANA_VERIFICATION.md) for the exact
new file manifest, pinned toolchain, 4 passing host tests, 21 passing SBF runtime tests and remaining gates.

**No commit, push, Mainnet deployment, public-chain transaction, real wallet connection, or private-key export occurred.**
Public deployment addresses remain null and transactionsEnabled remains false.
The inherited build-only Solana program ID is not a verified deployment.
The local preview binds only to 127.0.0.1:4173.

## Implemented behavior

- Removed the admin page and public Devnet functionality.
- Replaced the disconnected token minter with a lightweight two-chain frontend and explicit undeployed states.
- Reorganized Anchor into a Cargo workspace/program crate and pinned Anchor 1.0.0.
- Rewrote the curve: fixed raw-unit inventory, checked arithmetic, floor output, real-native payout limits,
  token transfers back to the vault on sells, and treasury-only fees.
- Solana mint authority is revoked after initial minting; freeze authority is never created.
- Added Base fixed-supply ERC-20, immutable curve and permissionless registry/factory.
- Enforced the specified public treasuries, with no creator-selected recipient.
- No admin/owner withdrawal, fee setter, treasury setter, market editor, pause, proxy, or migration controls.
- Added minimum received, short deadlines, Base exact-amount approval, chain/account checks,
  error-aware confirmations, and explorer links.
- Text is rendered through safe DOM APIs. Product bundles contain no test fixtures or generated activity.
- Frontend discovery/market data is fetched on request, with source block/slot and observation time.
- Chosen initial economics: one billion tokens, 6 Solana decimals / 18 Base decimals,
  30 SOL / 1 ETH virtual pricing offset, 25 bps entirely to platform treasury.
  These parameters require independent economic review and are not adjustable after launch.

## Every source/configuration file changed

### Modified existing files (4)

| File | Change |
| --- | --- |
| Anchor.toml | Build-only local program identity and Anchor 1.0.0; removed Mainnet provider/wallet settings. |
| Cargo.toml | Correct root workspace, release overflow checks and optimization. |
| config.json | Mainnet-only public configuration, both required treasuries, null deployments and disabled writes. |
| index.html | Mobile-first accessible static product shell, two networks, discovery/create/market/trade forms, CSP, honest unavailable states. |

### Deleted existing files (3)

| File | Reason |
| --- | --- |
| admin.html | No admin system is part of the product. |
| lib.rs | Removed broken root program; replaced by programs/pumplite/src/lib.rs and math.rs. |
| README_MAINNET.md | Replaced misleading deployment instructions with local-only README and detailed release gates. |

### Created files (29)

| File | Purpose |
| --- | --- |
| .gitignore | Excludes dependencies, generated artifacts, environment files, and common key/wallet file names. |
| .github/workflows/ci.yml | Frontend/Base/local browser and Solana host verification; no deployment or credentials. |
| package.json | Pinned frontend/build/test dependencies and local scripts. |
| pnpm-lock.yaml | Resolved dependency lockfile. |
| pnpm-workspace.yaml | Workspace definition and compatible patched transitive dependency overrides. |
| README.md | Local setup, product rules, architecture boundaries and known limitations. |
| docs/ARCHITECTURE.md | Exact formulas, accounting invariants, account layout responsibilities and client behavior. |
| docs/SECURITY.md | Threat boundaries and mandatory release gates. |
| docs/IMPLEMENTATION_REPORT.md | This file: complete manifest and verification results. |
| programs/pumplite/Cargo.toml | Anchor program crate and IDL features. |
| programs/pumplite/src/lib.rs | Market creation, buy/sell instructions, PDA/account constraints, fixed treasury, authority revocation and events. |
| programs/pumplite/src/math.rs | Pure checked raw-unit quote math and three Rust unit tests. |
| contracts/base/LaunchToken.sol | Fixed-supply ERC-20 without external mint/owner powers. |
| contracts/base/CurveMarket.sol | ETH curve, quote methods, slippage/deadline checks, treasury routing and reentrancy protection. |
| contracts/base/LaunchFactory.sol | Permissionless deployment, metadata validation, market registry and creation event. |
| web/app.js | Safe DOM rendering, routing, forms, quotes, wallet state, request/transaction gating and status. |
| web/math.js | Exact decimal parsing, integer quotes, slippage, metadata and receipt validation. |
| web/styles.css | Responsive system-font styling without media/font downloads. |
| web/adapters/solana.js | Lazy Solana RPC/wallet adapter, PDA/account decoding, instruction construction and confirmation checks. |
| web/adapters/base.js | Lazy EVM RPC/wallet adapter, factory discovery, approvals, trades and receipt checks. |
| web/generated/base-abi.json | Deterministic ABIs generated from the Solidity compiler; no addresses or bytecode deployment. |
| scripts/compile-base.mjs | Pinned Solidity compilation, artifacts/ABI generation and bytecode-size limits. |
| scripts/build.mjs | Clean local bundle build, code splitting, initial-size budget and non-product package exclusion. |
| scripts/check.mjs | JavaScript syntax and safety/configuration/ABI policy checks. |
| scripts/serve.mjs | Loopback-only static preview with basic security headers. |
| tests/math.test.mjs | Six integer, conservation, slippage, metadata and confirmation tests. |
| tests/base.test.mjs | Nine bytecode-level tests in an isolated in-memory EVM. |
| tests/browser.mjs | Desktop/mobile undeployed-state, routing, missing-wallet, layout and network-request checks. |
| tests/fixtures/Adversaries.sol | Test-only reentrant/rejecting trader and forced-donation contracts. |

The existing LICENSE is unchanged and remains a placeholder.

Ignored local outputs created: dependency directories node_modules/ and .pnpm-store/; compiled artifacts
build/base/LaunchToken.json, CurveMarket.json, LaunchFactory.json; build/frontend-metafile.json;
build/screenshots/home-390.png and home-1440.png; and dist/ containing the HTML/config/CSS/JS preview.
These generated directories are not source files and must not be committed.
No wallet or deployment key files were created.

## Verification performed

| Check | Result |
| --- | --- |
| Pinned dependency install, lifecycle scripts disabled | Passed; lockfile generated. |
| Frozen-lockfile offline reinstall | Passed, with the same dependency graph. |
| node scripts/compile-base.mjs | Passed for all three contracts, Solidity 0.8.30 / Shanghai / optimizer 200. |
| node --test tests/*.test.mjs | **15 passed, 0 failed, 0 skipped** (9 EVM + 6 JS). |
| node scripts/check.mjs | Passed JS syntax, deployment lock, treasury, DOM, network and privileged-function checks. |
| node scripts/build.mjs | Passed production bundling, clean output, initial payload budget and excluded-package assertion. |
| Browser checks at 390 × 900 and 1440 × 900 | Passed both viewports; no horizontal overflow, page errors, or external requests. Both lazy adapters load and report missing wallets correctly. |
| Screenshot inspection | Desktop/mobile screenshots inspected; corrected desktop feature-row wrapping. |
| git diff --check | Passed; Git reported only local LF/CRLF normalization warnings. |
| Production dependency audit | Initial: 1 high + 3 moderate. After compatible patches: **0 high/critical, 1 moderate remains**. |

Base deployed-runtime bytecode: LaunchToken 1,786 bytes; CurveMarket 3,352 bytes; LaunchFactory 9,197 bytes.
All pass the compiler script's runtime/initcode size limits.

Frontend measurement (gzip, includes initial static dependency closure):
- Initial HTML + CSS + configuration + JS: **9,032 bytes**.
- Additional Solana adapter: **97,326 bytes**.
- Additional Base adapter: **95,722 bytes**.
- All JS chunks together: 197,413 bytes.
These are compressed-size measurements, not a claim that the preview server compresses responses.
Production hosting must enable compression/caching. The enforced initial budget is 25 KB gzip.

The EVM tests verify actual locally executed contract bytecode: supply and mint rejection, factory membership,
fee transfers, vault inventory restoration without burning, reserve balance equality, event emission,
slippage/expiry rejection, quote/model parity over varied trades, donation isolation, reentrancy rejection,
failed payout rollback, rejecting treasury rollback, and metadata validation.
The math tests additionally exercise 1,000 buy/sell iterations across the two raw-unit models.

The test VM used its JavaScript fallback because its optional native websocket accelerator does not support
this host's Node 24 ABI. Tests passed without it. An optional ws native-validation peer warning also remains.
These are local test/runtime dependency observations, not production blockchain results.

## Dependency finding retained transparently

Patched ethers' ws dependency to 8.21.0 and jayson's uuid dependency to 11.1.1 via pinned overrides.
The remaining moderate advisory is stream-json, transitively under Solana web3/jayson:
[GHSA-528h-pc64-c93x](https://github.com/uhop/stream-json/security/advisories/GHSA-528h-pc64-c93x).
Its affected path-filter implementation can consume excessive CPU on deeply nested input.
A major-version override was not forced into jayson's Node API.
The build metafile verifies **zero shipped bytes** from stream-json and the build fails if it enters the browser output.
The retained package finding still needs resolution or explicit release review.
This was a production-dependency scan; a complete development-toolchain vulnerability review was not performed.

## Not tested / still required

- Rust host compilation, the three Rust tests, Anchor IDL generation and Solana SBF build:
  Rust/cargo/Anchor/Agave are absent. WSL is also not installed. No Cargo.lock could be generated locally.
- Solana runtime integration tests for CPIs, rent, account substitution, signer/authority enforcement,
  rollback, and client instruction compatibility are not implemented/executed yet.
- Real wallet signing, real Mainnet RPC data, deployed-address verification, Base L2-specific behavior,
  production gas/rent estimates, mobile-wallet handoffs, and Mainnet confirmation/finality behavior.
- Remote CI execution: the workflow exists locally but was never pushed or run remotely.
- Independent security audit, extended invariant fuzzing, economic/MEV review, and dependency review.
- Solana Metaplex metadata publishing, large-scale bounded discovery, and broad wallet interoperability.
- Production hosting/security headers, RPC service capacity, immutable Solana deployment policy,
  source/bytecode verification, licensing and release approval.

The complete ordered pre-deployment checklist is in SECURITY.md.
Passing these local tests does not establish Mainnet readiness.
