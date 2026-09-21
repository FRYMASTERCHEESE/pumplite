# Solana build and runtime verification

**Historical baseline:** current Anchor 1.0.2 results, 24 runtime tests and the System Program
security fix are recorded in [READINESS_FOLLOWUP.md](READINESS_FOLLOWUP.md). The original
1.0.0 artifact and counts below are historical evidence, not the release candidate.

Verified on 2026-09-21 in `C:\GitHub\pumplite`. The 17 recovered uncommitted source/configuration
changes were reviewed and preserved. This report and the security-document update bring the
combined unfinished/completed Solana work to 19 changed source/configuration/documentation files.
Nothing was committed, pushed, deployed, or published. No Mainnet or Devnet transactions,
wallet connections, user signing-material access, or expenditure of SOL/ETH occurred.

**Result: technically ready for the next local/adversarial testing stage; not Mainnet-ready.**
The actual Anchor program compiled to SBF and passed the process-local runtime suite.
The website remains write-disabled with null deployment addresses.

## Toolchain and compiled outputs

| Component | Verified version/result |
| --- | --- |
| Host Rust / Cargo | 1.94.0 / 1.94.0, x86_64-pc-windows-gnu |
| Anchor CLI / program crates / macro crates | 1.0.0, resolved in Cargo.lock |
| Agave CLI / cargo-build-sbf | 3.1.10 |
| SBF platform-tools | v1.52, bundled Rust 1.89.0-dev, --arch v0 |
| LiteSVM | 0.9.1; its resolved Agave runtime crates are 3.1.14 in Cargo.lock |
| Program host crate | pumplite 0.2.0 compiled successfully |
| Program SBF artifact | target/deploy/pumplite.so, 243,328 bytes |
| Runtime harness | pumplite-svm-tests compiled successfully |
| Generated Anchor IDL | target/idl/pumplite.json generated successfully |
| Workflow static validator | actionlint 1.7.12, no reported errors |

The SBF SHA-256 for this local build is:

`F6FA8F9E6CC920B9F493DEBA6841B0F9DA7A56586B4BA3E471939B67B57D6BD5`

This identifies the tested local artifact, not a deployed program or a reproducible-build claim.
The inherited program ID is only a build identity. The final build was from the recovered path.
Host, SBF and IDL compiler outputs were kept separately under ignored target directories.
All final compiler/test dependencies were available offline.

## Commands and exact results

| Check | Result |
| --- | --- |
| cargo fmt --all -- --check | PASS |
| cargo test --locked --offline -p pumplite --lib | PASS: 4 passed, 0 failed, 0 ignored |
| node scripts/build-solana.mjs | PASS: actual SBF compilation and ELF output |
| cargo test --locked --offline -p pumplite-svm-tests --features sbf-tests --test markets --no-run | PASS: runtime harness compiled |
| Same runtime command without --no-run, with PUMPLITE_SBF pointing at the freshly compiled ELF | PASS: 21 passed, 0 failed, 0 ignored |
| anchor idl build --program-name pumplite --out target/idl/pumplite.json -- --locked | PASS, with offline Cargo enabled |
| node scripts/check-solana-idl.mjs | PASS: instruction/account layout, flags, discriminators, events and fixed treasury schema |
| actionlint -shellcheck='' .github/workflows/solana.yml .github/workflows/ci.yml | PASS: YAML, workflow expressions and action/workflow syntax |
| node scripts/check.mjs | PASS: JS syntax, disabled writes, null deployments, treasuries, safe DOM and existing product policy checks |
| Deployment-output signing-file/placeholder checks | PASS: no deployment key file or configured wallet file created |
| git diff --check | PASS |

The SBF wrapper used PUMPLITE_SKIP_TOOLS_INSTALL=1 with the verified compiler already present.
It now rejects any cargo-build-sbf version other than the pinned version before using the
key-generation guard. No validator or RPC service was started.

The IDL checker verifies a reviewed wire schema; it does not execute the browser's transaction builder.
The runtime tests execute the real SBF artifact in LiteSVM, not a native replacement of the program.
Fixture balances and random fixture signers exist only in the process-local VM; signing material is
never exported or written. These fixtures do not represent live platform activity.

## Passing host tests

- `math::tests::rejects_unbacked_sells_and_overflow`
- `test_id`
- `math::tests::round_trip_preserves_inventory_and_cannot_profit`
- `math::tests::many_trades_conserve_supply_and_backing`

## Passing SBF runtime tests

- `missing_creator_signature_is_rejected_before_initialization`
- `incorrect_creation_nonce_cannot_substitute_mint_pda`
- `create_market_initializes_inventory_and_revokes_authorities`
- `buy_routes_exact_fee_and_backs_reserves`
- `arbitrary_treasury_is_rejected_before_funds_move`
- `missing_trader_signature_is_rejected`
- `creator_cannot_mint_more_or_freeze_inventory`
- `insufficient_buyer_sol_rolls_back_fee_and_inventory`
- `create_invalid_metadata_and_duplicate_market_are_rejected`
- `direct_donations_do_not_change_quotes_or_become_claimable_reserves`
- `no_real_liquidity_zero_amount_and_impossible_inventory_are_rejected`
- `insufficient_seller_tokens_roll_back_everything`
- `expired_and_excessive_deadlines_are_rejected`
- `buy_and_sell_slippage_fail_atomically`
- `only_program_pda_can_authorize_vault_token_transfers`
- `wrong_token_program_and_unknown_privileged_instruction_are_rejected`
- `wrong_vault_and_other_owners_token_account_are_rejected`
- `sell_returns_tokens_and_routes_fee_without_burning`
- `nonaliased_wrong_token_accounts_and_foreign_market_mint_are_rejected`
- `missing_native_or_token_backing_is_rejected`
- `repeated_trades_conserve_inventory_native_backing_and_invariant`

Together these cover market initialization and duplicate/invalid creation, fixed supply and authority
revocation, buys and sells, actual token movement (including selling back into the vault), treasury
fees, exact lamport deltas, rent and native backing, volume accounting, positive minimum output and
slippage rollback, deadlines, insufficient SOL/tokens/liquidity, wrong accounts/programs, missing
signatures, forged creation PDAs, direct vault theft attempts, donations and repeated trades.
The repeated-trade case checks conservation and the nondecreasing constant-product invariant after
each buy and sell. Failure snapshots exclude only the separate fixture payer's legitimate runtime fee.

## Failures corrected and remaining warnings

The original unfinished work encountered and corrected:

- Missing Anchor SPL token-interface/extension features used by generated mint initialization.
  Product instructions still require the legacy SPL Token program; Token-2022 product support was not added.
- Cargo initially resolved newer Anchor macros; Cargo.lock now pins the whole macro family to 1.0.0.
- Missing required Anchor provider configuration for IDL generation. The provider now names an
  intentionally nonexistent wallet placeholder, which verification never opens.
- A moved Rust test value and a test expecting the wrong error before Anchor's duplicate-account rejection.
- Windows linker/runtime setup, OneDrive read-only directory attributes and sandbox write restrictions.
  The recovered-path host/SBF/IDL builds all succeeded with isolated local tools.
- The workflow's signing-file scan initially matched dependency libraries and then Cargo fingerprint JSON.
  It now checks deployment outputs and the nonexistent wallet placeholder instead.
  Cargo's lib-solana_keypair.json is dependency fingerprint metadata, not a deployment key.

**No final host, SBF, IDL or runtime test failures remain.** The following build warnings remain visible:

- Agave warns that the combined cdylib/lib crate types limit its LTO optimization.
- The official Windows Agave archive has an empty syscalls.txt, so its post-build advisory reports
  standard Solana syscalls as unknown. The generated ELF loads and executes successfully in LiteSVM,
  including token and system CPIs. This advisory is not suppressed; clean Linux reproduction remains required.

The early Windows SDK helper also could not create an optional header-layout symlink. The runtime
libraries needed for these Rust builds were present, and both final builds succeeded. No toolchain
workaround changed program logic or relaxed runtime assertions.

## Workflow verification limits

The Ubuntu 24.04 job installs Rust 1.94.0 and checksum-verified Agave 3.1.10, Anchor 1.0.0 and
platform-tools v1.52 binaries. It runs formatting, host tests, SBF compilation, IDL generation/schema
checks, compiled-program runtime tests and deployment signing-file checks. Checkout is commit-pinned,
read-only, and does not persist credentials. There are no deployment jobs, wallet secrets or RPC calls.

The workflow was statically validated locally; it has **not run on GitHub**. No push or workflow
dispatch was performed. ShellCheck was unavailable on this Windows host and was explicitly disabled
for actionlint. Linux installation/linking and CI execution are therefore unverified, not passed.
The browser, Base runtime suite, real wallets, public-chain behavior and deployment process were
not retested as part of this Solana completion task.

## Security/economic findings and release blockers

No creator minting, substituted-treasury payout, unauthorized vault transfer or unbacked reserve payout
succeeded in the covered runtime tests. This is scoped test evidence, not a security audit.

1. **Frontend chain-check blocker resolved locally (2026-09-21 follow-up):** configuration now uses
   the full RPC hash `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`, verified against the
   [Solana namespace specification](https://namespaces.chainagnostic.org/solana/caip2).
   The adapter pins that identity independently of configuration, rejects mismatched configuration,
   rechecks RPC identity on reads/wallet operations and checks before requesting wallet connection.
   Seven local regression tests exercise configuration, valid/wrong/changing identities and RPC
   error/malformed responses using only a loopback HTTP fixture; no wallet is connected or transaction sent.
   Static Pages tests also exercise the bundled configuration guard. Six existing math/status tests,
   production asset generation/freshness, IDL/schema and source/deployment-lock checks pass.
   This is an RPC identity sanity check, not authentication of an untrusted RPC or proof of a wallet's
   selected network. Wallet interoperability and the transaction lifecycle remain separate gates.
2. **Economic decisions need review:** the 30 SOL virtual offset is pricing only, not spendable
   liquidity. Real reserves begin at zero. Fees and outputs round down; fees below 400 raw lamports
   round to zero. Slippage protection cannot eliminate sandwich/MEV risk within a user's tolerance.
3. **Locked funds/dust are intentional but need disclosure:** direct SOL/token donations do not update
   curve accounting and cannot be rescued. Round-trip dust, rent and burned/unredeemable token claims
   can leave funds locked. There is no migration, graduation, shutdown withdrawal or admin recovery.
4. **Independent assurance remains:** no independent audit, multi-user randomized/stateful fuzzing,
   maximum-size transaction/compute testing, or fresh Rust dependency-advisory audit was completed.
   Resolve previously recorded dependency findings before a release.
5. **Deployment identity and immutability remain undecided:** no deployed program was verified.
   Review an immutable deployment/finalization policy; a retained Solana loader upgrade authority
   could replace fund-handling code even though this program exposes no admin instructions.
6. **Product integration remains:** test the actual client instruction serialization/confirmation
   lifecycle using a safe local harness, then complete separately approved wallet/device testing.
   Resolve metadata publication, RPC capacity/rate limits, discovery scaling, HTTPS/security headers,
   fee/risk disclosures, licensing and treasury-receipt/ownership verification without requesting credentials.

Before real Mainnet deployment: obtain a green clean Linux CI run after publication is explicitly
approved; complete the above audit, fuzzing, economics and client gates; verify exact reproducible
artifacts, treasury constants and program identity; agree the immutable authority policy; and obtain
explicit deployment approval. Only after separately approved deployment and on-chain code/authority
verification should public addresses be configured and frontend writes considered for enablement.
No deployment or authority-change commands were prepared or executed here.

## Every changed source/configuration/documentation file

These list the complete combined Solana change set, including the 17 recovered files. Nothing was deleted.

| Modified existing file | Change |
| --- | --- |
| .github/workflows/ci.yml | Replaced the weak host-only Solana job with a reference to the dedicated workflow. |
| Anchor.toml | Pinned Agave alongside Anchor; parser-required local provider with nonexistent wallet placeholder. |
| Cargo.toml | Added the isolated runtime-test package and pinned SBF tools metadata. |
| README.md | Reproducible verification commands, exact passing counts and remaining-gate links. |
| docs/IMPLEMENTATION_REPORT.md | Points historical Solana-unverified notes to the completed verification report. |
| docs/SECURITY.md | Records the completed local foundation and updates remaining release gates. |
| programs/pumplite/Cargo.toml | Rust floor, required Anchor SPL features and recognized Solana target cfg. |
| programs/pumplite/src/lib.rs | Rustfmt formatting of the preserved program; no fund-handling semantic rewrite in this task. |
| programs/pumplite/src/math.rs | Rustfmt plus an additional insufficient-real-liquidity boundary assertion. |

| Created file | Purpose |
| --- | --- |
| .cargo/config.toml | Rust-version-aware dependency resolution policy. |
| .github/workflows/solana.yml | Pinned compile/IDL/runtime CI with no deployment or signing credentials. |
| Cargo.lock | Resolved dependency lock, including Anchor macro and SVM dependency versions. |
| rust-toolchain.toml | Rust 1.94.0 and rustfmt pin. |
| scripts/build-solana.mjs | Version-checked SBF build with a directory guard preventing deployment-key generation. |
| scripts/check-solana-idl.mjs | Generated interface compatibility and fixed-treasury schema assertions. |
| tests/solana/Cargo.toml | Pinned LiteSVM harness and explicit sbf-tests feature gate. |
| tests/solana/markets.rs | 21 compiled-SBF success, failure, accounting and authority tests. |
| tests/solana/README.md | Safe local test instructions, Windows validation context and limits. |
| docs/SOLANA_VERIFICATION.md | This complete results, issues and file-manifest report. |

Ignored/generated outputs: build/solana-*.log, isolated build/tooling dependencies,
target/verification, target/sbf-build, target/idl-build, target/deploy/pumplite.so and
target/idl/pumplite.json. These are local verification outputs, not source changes to commit.
The key guard was removed after each build and contained no key material.
