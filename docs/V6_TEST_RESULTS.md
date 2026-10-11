# V6 verification results — 12 October 2026 (New Zealand)

Both candidates remain undeployed and disabled. All checks below ran locally;
GitHub reproduction has a separate status on the draft PR. These results are
engineering verification, not independent audit approval.

| Run | Result |
| --- | --- |
| `pnpm test` (existing Base, V3, website, Solana builders and new wire regressions) | 497 passed; 0 failed/cancelled/skipped |
| `pnpm test:v6` | 41 passed; 0 failed/cancelled/skipped |
| V6 breakdown | 13 Base candidate, 13 adversarial Base security, 2 frontend/wallet lifecycle, 5 Base calldata, 8 Solana instructions |
| `cargo test --locked --workspace --lib` | 13 passed: 4 existing + 9 V6; 0 failed/ignored |
| Compiled Solana V6 SBF `markets` integration suite | 35 passed; 0 failed/ignored |
| Pages export/browser integration | 15 PASS scenarios, including 390/768/1440px and wallet consent |
| Production browser runner | 2 viewport scenarios passed (390/1440px) |
| Isolated actual V6 builders in Chromium | 2 viewport scenarios passed (390/1440px) |
| Browser bundling | Both V6 adapters bundle; no unresolved imports or excluded tooling |
| Contract compilation | Base V6 Solidity + Solana V6 ELF succeeded |
| Formatting, repository safety, production locks, Pages build/freshness | Passed |
| JavaScript audit policy | Passed; 3 existing reviewed moderate advisories remain |
| RustSec audit/policy | 0 vulnerabilities; 6 existing reviewed warnings remain |
| Existing token-verification gate suite | 4,000 gates passed |
| Public Pages read-only health | Passed; reviewed V2/Solana configuration and assets retained |

Counts overlap: instruction tests are also in the 497-test run. Do not sum them
as unique tests. No real-wallet signing or mainnet transaction was tested.
Original Solana host/unit and JavaScript suites were rerun; the compiled SBF
integration run above specifically executes the new V6 program.

## Mayhem sizing and instruction evidence

Both engines clip genesis sell sizing to real spendable curve backing and the
remaining outflow cap **before** quote validation. Pause reserves stay intact.
Agent buys also cap by available agent bank and remaining inflow. Solana's
deterministic seeded sizing regression explicitly reproduces an oversized genesis
quote and checks the clipped positive quote. Base randomized agent cycles and
Solana compiled-program cycles check aggregate backing and token conservation.

Base calldata tests decode all three actual factory modes (0/1/2), supply precision
and invalid-mode rejection. The local-EVM frontend executes creation, user trades,
voluntary bank funding, Manual requests, exact approvals and rejected-wallet paths.
Solana tests execute actual website-built instructions against SBF, compare account
metas/discriminators/u64 values and decode real VM market accounts in the browser
decoder. Creator/controller constraints, future-slot hash authentication, fee
accounting, expiry/finalization and rollback are covered. The controller fixture
limitation is documented in `V6_CANDIDATE_READINESS.md`.

An adversarial seeded Base test initially reached its 120-second test limit while
Rust audit tooling compiled concurrently. The unchanged test passed on rerun,
and the final combined 41-test suite passed in 167.49 seconds. No timeout or
security assertion was weakened. Ganache uses its JavaScript fallback on this
Windows/Node version. The Windows SBF SDK's syscall-table warnings remain visible;
Linux CI reproduction must independently pass.

Rust warnings: unmaintained `ansi_term`, `bincode`, `derivative`, `libsecp256k1`,
`paste`, plus reviewed tooling-only `rand 0.7.3` unsoundness. RustSec database:
1,296 advisories, commit `7eebec69c352c7191b1f13eb95dd510eeca5d1de`.

## Cost snapshot and readiness

`deployments/v6-cost-estimate.json` records read-only RPC estimates and exact
candidate hashes. At its recorded observation, Base factory gas is 5,199,029:
execution plus L1 upper bound **0.000031558107775795 ETH**. Solana's 343,912-byte
binary requires **1.74878492 SOL retained rent**, plus **0.001935 SOL** upload
fees in the specified 900-byte/no-priority/no-retry scenario: **1.75071992 SOL**.
The loader normally reuses buffer rent; 3.49863108 SOL is conservative separate
prefunding, not the normal required minimum. These are current estimates, not
guaranteed final charges. Approved identities, a rebuilt Solana program ID,
priority fees/retries, allocation and release-time RPC values can change them.

Base V6: locally verified development candidate; production approval blocked.
Solana V6: locally compiled/executed development candidate with an unassigned ID;
production approval blocked. Both need independent security/economic review,
approved controllers and real keeper operation, legacy-safe website activation,
and explicit cost/release approval. External DEX migration is not implemented.
See `V6_CANDIDATE_READINESS.md` for the complete remaining requirements.

No deployment, spending, production merge or live settings change occurred.
