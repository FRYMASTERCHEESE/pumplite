# Readiness follow-up — 2026-09-22

> Historical checkpoint. Superseded by [release-candidate verification](RELEASE_CANDIDATE.md).

## Outcome

Local release-candidate work only; neither chain is approved for Mainnet deployment.
No real wallet was connected, credentials accessed, public-chain transaction sent, funds spent,
contract deployed, commit created, push made or real-money trading enabled. Local test fixtures
use ephemeral VM accounts and are never published as product activity. Configuration retains
transactionsEnabled=false and null deployment addresses.

The user confirmed green Solana verification #2, Local verification #5 and Pages deployment #32
for the preceding commit. These newer changes require their own clean CI run.

## Changes and findings

- Reproduced [RUSTSEC-2026-0144](https://rustsec.org/advisories/RUSTSEC-2026-0144.html): Anchor 1.0.0
  accepted a substituted executable account as Program<System> on sell. This demonstrated an
  account-validation failure, not a fund-draining exploit.
- Upgraded Anchor CLI, program/test crates and all macro crates to exactly 1.0.2. Rust 1.94.0,
  Agave 3.1.10 and SBF platform-tools v1.52 remain pinned. CLI downloads have verified SHA-256 hashes.
- Added explicit System Program constraints to create/trade accounts and the IDL gate.
- Extracted actual Solana unsigned builders for frontend-to-SBF testing; added side, amount, nonce
  and metadata validation and four wire-format/raw-integer boundary tests.
- Added 384 seeded trades across four users, independent integer reference calculations, exact
  reserves/fees/lamports/token supply/invariant checks and 24 interleaved slippage rollbacks.
- Added actual client-built create/buy/sell execution, maximum metadata, packet and compute checks.
- Hardened Base RPC-before-wallet validation, failed-session cleanup, market/token correspondence,
  invalid trade rejection and wallet rechecks immediately before approval/trade.
- Added Base frontend lifecycle tests using a synthetic EIP-1193 provider and process-local EVM:
  access, chain switch, create, buy, exact approval, sell, failed-trade reporting, account/network
  changes and rejection. No real wallet, RPC listener, chain fork or public transaction is involved.
- Reviewed LaunchFactory, CurveMarket and LaunchToken. Existing fixed treasury, supply, reserves,
  slippage/deadline checks, reentrancy protection, payment rollback and no-admin behavior remain
  covered; no Solidity source changed in this follow-up.
- Patched solc's tmp dependency to 0.2.7 and the local VM websocket dependency to ws 8.21.0.
- Pinned CI actions by verified commit SHA, disabled credential persistence, installed frontend
  dependencies in Solana CI, expanded trigger paths, and added dependency-security gates.
- Clarified fee rounding, locked dust and slippage disclosures. Wallet SDKs remain lazy-loaded.

## Verification

| Check | Result |
| --- | --- |
| Rust host compilation/tests | 4 passed |
| Anchor 1.0.2 SBF build | Passed; actual ELF, no deployment-key generation |
| SBF runtime suite | 24 passed, 0 failed/ignored |
| Frontend-to-SBF create/buy/sell | Passed, including 32-byte name, 10-byte symbol, 200-byte URI |
| Unsigned client packets | Within 1232-byte limit for tested transactions |
| Compute bounds | Below 200,000 units; observed create 62,731, buy+ATA 47,801, sell 24,467 |
| Anchor 1.0.2 IDL generation/schema | Passed; fixed System Program and treasury checked |
| Solidity compilation | All three contracts; runtime sizes 1786 / 3352 / 9197 bytes |
| JavaScript/Base suite | 28 passed, 0 failed (9 Base contracts, 2 Base frontend, 6 math/status, 4 Solana wire, 7 Solana network) |
| Pages, source syntax, workflow checks | Passed: build/freshness, 390px and 1440px exported Pages, source safety, actionlint (ShellCheck unavailable) |
| Rust formatting | Passed with Rust 1.94.0 rustfmt |

SBF SHA-256: `48066AB104647CE112B61B6C1AB3FD7BA137BED72A91E0685270DDD5CD03083E`.
This identifies a local artifact, not deployed code or independent reproducibility verification.
The pre-existing LTO/syscall-reporting warnings remain; actual runtime execution succeeded.
Local checks used Windows/Node 24; CI uses Node 22 and Ubuntu/Windows. Ganache's optional native
websocket accelerator lacks this Node ABI; its JavaScript fallback passed. No test RPC listener
was exposed. Previously passing checks were retained unless changes required reverification.

Resolved intermediate failures: a biased randomized trade selector produced dust-only sells;
the new attack regression intentionally failed on Anchor 1.0.0; IDL generation initially lacked
Agave on PATH. These were corrected, not skipped. The final status table governs current results.

## Security scan results and limitations

JavaScript high/critical gate: passes. One moderate stream-json advisory remains,
GHSA-528h-pc64-c93x. Its affected filter implementation contributes zero browser bytes; the build
rejects shipping stream-json. An incompatible major-version override into jayson was not forced.
An upstream-compatible fix or documented release-risk acceptance is still required.

RustSec/OSV scan: 385 locked registry packages, zero non-informational RustSec vulnerabilities.
Six informational warnings remain: ansi_term, bincode, derivative, libsecp256k1 and paste are
unmaintained; rand 0.7.3 has conditional custom-logger unsoundness. Dependency inspection places
rand 0.7.3 only in the LiteSVM/Agave test graph, not the PumpLite program graph.
The CI scanner fails on service/incomplete-response errors and non-informational RustSec findings.
These gates do not constitute an independent audit or blanket acceptance of remaining warnings.
Local ignored reports: build/rustsec-audit.json and build/dependency-audit.json.

## Remaining engineering verification

These tasks can still be developed/tested locally and are not mislabelled as external-only:
- Broader fuzz/adversarial campaigns, integer extremes and production feature-set coverage beyond
  the tested seeds and packet/compute cases.
- Full lifecycle fault coverage for signing rejection, expiry, dropped/replaced transactions,
  disconnects during signing, rate limits/failover and malicious RPC responses. Current local
  tests cover portions, not every provider/device behavior.
- Production metadata publication design and bounded discovery/indexing at larger scale.
- Remaining dependency-warning disposition and independent final artifact reproducibility.

## External/manual release gates

Both chains: independent security/economic review; approve fixed supply, fee and pricing offsets,
locked donations/dust and no migration/recovery; choose license/copyright ownership; verify treasury
ownership and ability to receive funds without revealing credentials; choose production RPC and
metadata/storage services; validate HTTPS/security headers and supported mobile/desktop wallets.

Solana: approve final program identity and immutable deployment/finalization policy, verify the
artifact and loader authority after separately authorized deployment, and decide wallet-visible
metadata integration. A retained loader upgrade authority can replace fund-handling code.

Base: verify final factory source/bytecode/compiler settings, treasury receipt behavior, wallet
chain switching, gas estimates and allowance UX on supported real devices after separate approval.
A reverting treasury halts trading. No proxy/admin fund controls are present.

Next step: review and approve committing/pushing this diff so patched Anchor and expanded tests run
in clean CI. Then commission independent review and close the product/infrastructure decisions.
Deployment and trading enablement require later, separate approval.

## Exact changed-file manifest

Git status codes: M modified, D deleted, ?? newly added. Generated chunks replace their older hashed filenames.

- M `.github/workflows/ci.yml`
- M `.github/workflows/solana.yml`
- M `Anchor.toml`
- M `Cargo.lock`
- M `README.md`
- M `assets/app.js`
- D `assets/chunks/base-GR6O3CIR.js`
- D `assets/chunks/solana-4EOKEJGQ.js`
- M `docs/SECURITY.md`
- M `docs/SOLANA_VERIFICATION.md`
- M `index.html`
- M `pnpm-lock.yaml`
- M `pnpm-workspace.yaml`
- M `programs/pumplite/Cargo.toml`
- M `programs/pumplite/src/lib.rs`
- M `scripts/check-solana-idl.mjs`
- M `tests/solana/Cargo.toml`
- M `tests/solana/README.md`
- M `tests/solana/markets.rs`
- M `web/adapters/base.js`
- M `web/adapters/solana.js`
- ?? `assets/chunks/base-FJBUESEF.js`
- ?? `assets/chunks/solana-CRIH3QRY.js`
- ?? `docs/READINESS_FOLLOWUP.md`
- ?? `scripts/audit-rust.mjs`
- ?? `tests/base-frontend.test.mjs`
- ?? `tests/solana-client-fixture.mjs`
- ?? `tests/solana-instructions.test.mjs`
- ?? `web/solana-instructions.js`
