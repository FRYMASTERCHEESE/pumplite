# Release candidate verification — 2026-09-22

This report supersedes READINESS_FOLLOWUP.md. Baseline: 2c67ca6503bd66384f84420c7e498c3bdd4a77e1.
The local verification gates below passed. The exact pushed commit must also have green
Solana verification, Local verification and Pages workflows; check its GitHub Actions results.
Neither chain is approved for a real-money launch. No real wallet, wallet secret, contract deployment
or paid chain transaction was used. Public RPC checks queried chain identity only.
Configuration still has transactionsEnabled=false and null program/factory addresses.

## Changes

- Solana adapter clears failed reconnect state, compares the wallet-returned message before submission,
  validates creator/mint/market PDA derivation and bump, reserve range, token-account owner/mint/wallet/
  layout/state, and trade token correspondence. Failures cannot be reported as confirmations.
- Base receipt waiting is bounded to two minutes and rejects unexpected receipt hashes and replacements.
  No automatic transaction retry is introduced. Exact approval and interrupted-sell behavior is tested.
- Both market pages display creator metadata URI as untrusted text without downloading metadata/images.
  Long URIs wrap on mobile. Base now reads metadataURI at the same block as its reserve snapshot.
- Added independent-target SBF repeat builds and build/IDL/Anchor identity agreement checks.
- Solidity builds normalize source newlines, repeat compilation with a self-contained standard input,
  compare creation/runtime bytes, ABI and metadata, and emit compiler/source/bytecode hashes.
  VM code is compared with compiled runtime templates; immutable values are checked separately.
- Added the adversarial/accounting/lifecycle tests listed below. No program or Solidity contract logic
  changed in this pass; the pinned Anchor 1.0.2 program remains the security-patched baseline.
- Dependency warnings have exact version/scope dispositions in dependency-review.json, due for review
  before 2026-12-22 UTC. New/changed warnings, vulnerabilities, expired reviews and service failures block CI.
- CI repeats SBF builds, checks advisories, and retains only explicitly named public compilation/audit
  artifacts for 30 days. No wallet configuration, deployment signing files or contract deployment step.
- Root LICENSE replaced at the owner's request with All Rights Reserved, Copyright © 2026 Corey Vibe.
  Existing explicit file-level MIT statements and all third-party licenses are unchanged. The repository
  is therefore not uniformly proprietary; this change does not revoke earlier permissions.

## Verification results

| Gate | Final local result |
| --- | --- |
| Rust 1.94.0 formatting and program host compilation | Pass; 4 host tests |
| Anchor 1.0.2 / Agave 3.1.10 / platform-tools 1.52 SBF | Pass; actual ELF |
| Independent Cargo target directory rebuild | Byte-identical SBF |
| Isolated SBF runtime | 26 passed, 0 failed/ignored; actual frontend create/buy/sell included |
| Anchor IDL generation and strict schema/identity constraints | Pass |
| Solc 0.8.30 repeated source/bytecode compilation | Pass; all 3 contracts |
| JavaScript/Base tests | 54 passed, 0 failed/skipped |
| Root Pages generated asset freshness | Pass; all generated assets |
| Exported /pumplite/ site at 390px and 1440px | Pass; both SDKs, metadata wrapping, no external requests or wallet calls |
| Static preview at 390px and 1440px | Pass; disabled writes, routes, no overflow or errors |
| Syntax, fixed config/treasury/explorer/HTTPS, safe DOM, absent admin checks | Pass |
| Workflow actionlint | Pass; optional ShellCheck unavailable locally |
| JavaScript advisory policy | Pass with 1 reviewed moderate advisory, no high/critical findings |
| RustSec/OSV | 385 packages; 0 non-informational vulnerabilities, 6 reviewed warnings |
| Read-only production RPC identity | HTTP 200; full Solana Mainnet genesis and Base 8453 match |
| Public GitHub Pages headers | HTTP 200 and HSTS; meta CSP exists; no frame-protection response header |

SBF SHA-256 on Windows, both builds:
48066ab104647ce112b61b6c1ab3fd7ba137bed72a91e0685270ddd5cd03083e.
This proves repeatability across build target directories in this environment, not cross-OS or
independent third-party reproducibility. CI performs its own Ubuntu repeat comparison.

Base runtime sizes: LaunchToken 1786, CurveMarket 3352, LaunchFactory 9197 bytes.
Local EVM gas observed: create 1,340,348; buy 121,063; exact approval 46,426; sell 73,267.
Gas-estimation bounds and actual receipts passed. These are local execution units, not Base fee quotes:
Mainnet L1 data fees, network prices and wallet estimation must be checked separately.
Self-contained compiler input and manifests are generated under build/base/ and retained by CI.

The Base multi-user campaign executes 64 trades over two seeds with exact treasury/native/token
accounting, fees, volume, event values and nondecreasing invariant; 8 slippage rollback checks.
The Solana campaign retains 384 trades over three seeds/four users with 24 interleaved rollback cases.
These bounded campaigns are useful regression coverage, not exhaustive fuzzing or economic proof.
Initial exported page transfer budget: 9,176 bytes gzip; chain SDKs remain lazy-loaded.

Intermediate verification failures were corrected: an overly broad Solidity artifact comparison
included import-order-dependent internal AST IDs (bytecode/metadata did match), and a uint256-maximum
quote test incorrectly expected a revert where full-precision arithmetic correctly returns inventory
minus one unit. Neither correction weakens contract arithmetic or skips a contract failure.

## Remaining security findings

The moderate [stream-json advisory](https://github.com/advisories/GHSA-528h-pc64-c93x) remains in the
lockfile. The build enforces zero shipped browser bytes. Node jayson uses StreamValues/Verifier, not
the affected path filters. No production Node service is shipped. A forced incompatible major upgrade
is inappropriate; re-review before changing that exposure or the pinned graph.
Rust informational warnings: ansi_term, bincode, derivative, libsecp256k1 and paste are unmaintained;
rand 0.7.3 has conditional custom-logger unsoundness. Only bincode occurs in the pumplite normal/build
graph; the other affected packages are isolated runtime/tooling dependencies. No custom rand logger
is installed. These are engineering dispositions, not an independent auditor's approval.
Local Ganache uses its JS fallback because the optional native websocket module lacks the Node 24 ABI.
SBF LTO/syscall-reporting warnings persist; actual VM load and execution passed.

## Remaining pre-deployment work and decisions

Both chains are candidates for independent review, not approved for Mainnet deployment.

1. Independent security/economic review of immutable reserves, fixed supply, fee rounding, locked
   donations/dust, no migration/rescue and MEV/slippage exposure. Approve these economics and disclosures.
   Broader fuzzing, production feature-set and hostile-provider testing remain appropriate audit work.
2. Owner verifies treasury ownership and ability to receive payouts using their own tools. Never send
   keys or seed phrases to a developer or this assistant. Base treasury rejection intentionally rolls
   back the whole trade; ownership/callback availability cannot be proven by local EVM fixtures.
3. Choose production RPC capacity/SLA and indexer scope. Current public endpoints reported the right
   chains, but this is not load/failover testing or an uptime guarantee. Solana discovery retrieves all
   market keys before paging eight account bodies, so it is not bounded at large market counts. An
   indexer/service choice and implementation/load tests remain before claiming large-scale support.
4. Approve metadata scope. Market name/symbol/URI integration is verified; Metaplex wallet-visible
   metadata, storage/pinning services and general mobile wallet deep links are not implemented. Those
   features need a reviewed design and further local engineering if required for launch. Current
   mobile support is limited to compatible injected-wallet browsers.
5. Validate supported real wallets/devices, signing previews, disconnects, slow/hostile RPCs and final
   network fee estimates. Synthetic coverage does not establish real-wallet compatibility.
6. Configure a production host/proxy with anti-framing headers before enabling financial interactions.
   Pages has meta CSP and HSTS, but frame-ancestors cannot be supplied through a meta tag. Keep RPC
   connect-src aligned with the chosen endpoints. See the [CSP restriction](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
7. Resolve any intended ownership/licensing scope beyond the new root notice: explicit existing MIT
   file-level notices were preserved at the owner's instruction. Third-party licensing is unchanged.

Solana specifically: the checked ID is a build identity, not proof that an owner-controlled deployment
identity exists. Owner must select/approve the final program ID and immutable loader/finalization
policy without sharing signing material. If the ID changes, rebuild, regenerate IDL, rerun PDA/runtime
checks and renew artifact review. Verify final on-chain code and loader authority only after a separately
approved deployment. A retained loader upgrade authority can replace fund-handling code.

Base specifically: use the reviewed self-contained compiler input and factory artifact; choose the
owner-controlled deployment process and verify factory runtime/source and immutable market/token
relationships after separate approval. Verify treasury receipts and actual Base gas/data fees.

Exact next step: review this release-candidate evidence and commission independent security/economic
review, while approving treasury ownership, final Solana identity/immutability, metadata/mobile scope
and production infrastructure. Resolve findings and rerun the gates. Only then separately authorize
contract deployment; keep trading disabled through deployed-code/authority checks. No deployment is
performed or authorized by this report.

## Full passing test inventory

### Host tests (4)

- test_id
- math::tests::rejects_unbacked_sells_and_overflow
- math::tests::round_trip_preserves_inventory_and_cannot_profit
- math::tests::many_trades_conserve_supply_and_backing

### Compiled Solana runtime tests (26)

- missing_creator_signature_is_rejected_before_initialization
- buy_routes_exact_fee_and_backs_reserves
- insufficient_buyer_sol_rolls_back_fee_and_inventory
- creator_cannot_mint_more_or_freeze_inventory
- incorrect_creation_nonce_cannot_substitute_mint_pda
- buy_and_sell_slippage_fail_atomically
- expired_and_excessive_deadlines_are_rejected
- insufficient_seller_tokens_roll_back_everything
- missing_trader_signature_is_rejected
- arbitrary_treasury_is_rejected_before_funds_move
- create_market_initializes_inventory_and_revokes_authorities
- direct_donations_do_not_change_quotes_or_become_claimable_reserves
- create_invalid_metadata_and_duplicate_market_are_rejected
- no_real_liquidity_zero_amount_and_impossible_inventory_are_rejected
- only_program_pda_can_authorize_vault_token_transfers
- incorrect_market_bump_and_readonly_reserves_cannot_authorize_transfers
- sell_returns_tokens_and_routes_fee_without_burning
- wrong_token_program_and_unknown_privileged_instruction_are_rejected
- wrong_vault_and_other_owners_token_account_are_rejected
- missing_native_or_token_backing_is_rejected
- nonaliased_wrong_token_accounts_and_foreign_market_mint_are_rejected
- substituted_executable_system_program_is_rejected_for_create_buy_and_sell
- unexpected_mint_or_freeze_authority_rejects_both_trade_directions
- repeated_trades_conserve_inventory_native_backing_and_invariant
- frontend_instructions_execute_max_metadata_create_buy_and_sell_within_compute_budget
- seeded_multi_user_sequences_conserve_reserves_fees_and_supply

### JavaScript/Base tests (54)

- Base adapter rejects wrong configuration and wrong RPC before wallet access
- Base frontend lifecycle executes only in a process-local EVM with a synthetic EIP-1193 provider
- factory records real contracts, fixed supply and immutable treasury
- buy/sell route fees and return actual inventory without burning
- slippage, deadlines, zero minimum and unbacked sells revert atomically
- quotes match integer model through varied round trips
- donations cannot move quotes or create spendable accounting
- reentrant seller cannot enter market again during payout
- failed native payout rolls back reserve changes and token transfer
- rejecting treasury makes the entire buy revert rather than losing funds
- metadata rejects invalid names, symbols, lengths and protocols
- VM bytecode matches compiled source; immutable values and gas budgets are verified
- rejecting treasury rolls back sell inventory, reserves, allowance and fees
- three-user seeded trades preserve exact fees, balances, supply, volume and invariant
- integer extremes, missing allowance and insufficient balances fail without accounting changes
- dependency policy accepts only the exact reviewed version and severity
- dependency policy fails closed for service errors, incomplete data and expired reviews
- exact decimal amounts never pass through floating point
- round trips do not create value and preserve the constant product
- single buyer cannot receive more native currency on immediate round trip
- unbacked sales, dust and invalid slippage are rejected
- metadata byte limits and protocols are validated
- failed receipts cannot be shown as successful
- Solana metadata and market bytes decode using the same creator/mint/market PDA derivation as creation
- Solana reads reject malformed identities, seeds, owners, UTF-8 and reserve values
- unsigned builders reject invalid side, raw-unit overflow and zero slippage bounds
- create builder enforces metadata byte limits and exact nonce length
- maximum metadata serializes into an unsigned packet with no wallet or signer
- u64 values above Number precision retain their exact little-endian wire representation
- configuration pins the full Mainnet hash and retains the deployment lock
- strict chain check rejects truncated, different and malformed identities
- adapter accepts a full Mainnet RPC response before enforcing absent deployment
- wrong-chain RPC blocks discovery, market reads and wallet access
- RPC identity is checked again rather than cached after one valid response
- RPC errors fail closed without querying market data
- malformed RPC genesis responses fail closed
- Solana synthetic submission: reject
- Solana synthetic submission: disconnect
- Solana synthetic submission: mutate
- Solana synthetic submission: broadcast
- Solana synthetic submission: expired
- Solana synthetic submission: dropped
- Solana synthetic submission: malformed
- Solana synthetic submission: reverted
- Solana synthetic submission: success
- Solana failed reconnect discards the preceding account
- Solana token balance rejects foreign, truncated, frozen and unsafe RPC accounts
- Base settlement: timeout
- Base settlement: replaced
- Base settlement: cancelled
- Base settlement: reverted
- Base settlement: missing
- Base settlement: wrong-hash
- Base settlement: success

## Exact changed-path inventory

- M .github/workflows/ci.yml
- M .github/workflows/solana.yml
- M LICENSE
- M README.md
- M assets/app.js
- D assets/chunks/base-FJBUESEF.js
- D assets/chunks/solana-CRIH3QRY.js
- M assets/styles.css
- M docs/READINESS_FOLLOWUP.md
- M docs/SECURITY.md
- M index.html
- M scripts/audit-rust.mjs
- M scripts/check-solana-idl.mjs
- M scripts/check.mjs
- M scripts/compile-base.mjs
- M tests/base-frontend.test.mjs
- M tests/base.test.mjs
- M tests/pages.mjs
- M tests/solana/markets.rs
- M web/adapters/base.js
- M web/adapters/solana.js
- M web/app.js
- M web/styles.css
- ?? assets/chunks/base-YBKEY52Z.js
- ?? assets/chunks/solana-7MKJ6TD2.js
- ?? docs/RELEASE_CANDIDATE.md
- ?? docs/dependency-review.json
- ?? scripts/check-dependency-review.mjs
- ?? scripts/check-sbf-reproducibility.mjs
- ?? scripts/dependency-policy.mjs
- ?? tests/dependency-policy.test.mjs
- ?? tests/solana-account.test.mjs
- ?? tests/transaction-lifecycle.test.mjs
