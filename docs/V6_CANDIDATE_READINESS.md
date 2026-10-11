# PumpLite V6 candidate readiness — 12 October 2026

These are additive development candidates. Neither has been deployed, approved,
merged into the live site, or activated. No cryptocurrency was spent. Production
`config.json`, existing V2 contracts, V3 development, Solana tiny markets, PLITE,
liquidity pools and wallet approval rules remain unchanged.

## What is implemented

Base V6 has a separate factory, token and curve implementation. Creation uses
`createMarketV6` and immutable modes Classic=0, Auto=1, Manual=2. Classic supports
the existing fixed/mintable supply choices. Mayhem creates separate genesis
inventory equal to the initial curve inventory. Agent activity has separate
events and volume. Manual requests require the creator; commit/reveal requires
the configured controller. Auto still requires a working external keeper.

Solana V6 is a separate Anchor program with `mint-v6` and `market-v6` PDAs,
fixed supply and revoked mint/freeze authorities. Classic mints one billion
tokens at six decimals; Mayhem adds a separate one-billion-token agent inventory.
It implements real creation, buy/sell, immutable launch modes, voluntary support,
agent funding, creator-only Manual requests, controller commit/reveal, expiry and
permissionless finalization. The public build ID is **unassigned**, not deployed:
`5squ4au25LQGEWrFhQejekDQAr9pjiXwscvFCoQFcAkw`. A new user-controlled public
program ID and a rebuild are required before release approval.

Both candidates segregate voluntary agent funding from curve backing and forbid
controller withdrawals. Agent buys move bank funds into the curve; sells move
curve funds into that bank. Aggregate actual funds and inventory are conserved.
Unused agent tokens are burned at finalization and bank funds become curve backing.
Public purchases and support provide real ETH/SOL backing; creation alone does not.
There is no automatic DEX graduation or migration in these candidates.

## Sizing and security corrections

- Agent sells now calculate the gross size, cap it by real spendable reserves and
  remaining flow allowance, then validate the clipped quote. Large genesis sells
  no longer fail before clipping. The pause reserve remains protected.
- Agent buys are limited by both remaining flow allowance and the actual bank.
- Randomness includes a future block/slot hash. Commitments cannot be revealed in
  that target block/slot. Abandoned commitments consume the finite attempt budget.
- Base deployment limits have hard bounds: up to 48 attempts, at least five
  minutes between attempts, 0.001–0.01 ETH buys, at most 0.1 ETH each direction,
  at least 0.001 ETH pause reserve and 1–5% inventory sell sizing.
- Solana uses corresponding bounded instructions, authenticated SlotHashes,
  constrained accounts/PDAs, treasury checks, backing checks and atomic rollback.
- The staged adapters and actual unsigned builders are tested separately. Live
  Create and market routing still use the existing reviewed production adapters.

## Verification evidence

See the accompanying final test-results report for exact counts and exit status.
Coverage includes local EVM creation/trades, reentrancy, rejecting recipients,
rollback, slippage/deadlines, full-precision integer extremes, seeded multi-user
conservation, wallet rejection/account changes, exact token allowances, all three
launch modes, compiled Solana SBF account validation, actual website-built
instructions, and browser decoding of real VM accounts. Browser tests run at
390px and 1440px with wallet access and non-local requests blocked.

The Rust controller fixture disables VM signature verification only when
impersonating the fixed public controller. No controller private key exists in
the test. Signer/account/role constraints still execute in SBF. Ordinary and
unauthorized user tests use process-local fixture signatures. This does not prove
that a real keeper signer or mainnet wallet is operating.

Dependency scans retain all existing warnings: three reviewed JavaScript
moderate advisories; five Rust unmaintained-package warnings and one reviewed
`rand 0.7.3` unsoundness warning in tooling. The Rust gate checks that tooling-only
warnings have not entered the V6 normal/build dependency graph. These scoped
reviews and tests are not an independent security or economic audit.

## Costs and cheapest reviewed planning route

Run `node scripts/estimate-v6-mainnet-costs.mjs` after compiling both candidates.
It cannot sign or submit. It reads Base execution gas and the official GasPriceOracle
L1 fee upper bound, plus Solana rent and `getFeeForMessage` for unsigned upload
message fixtures. Snapshot values, exact build hashes and observed blocks/slots
are in the accompanying cost JSON.

The Solana scenario uses exact binary-length allocation, 900-byte writes, no
priority fee and no retries. Loader-v3 drains the buffer to the payer before
funding ProgramData, allowing rent funds to be reused. Twice-length allocation
increases retained rent. Exact allocation may need a separately approved extension
for a larger future upgrade. Failed uploads can leave a funded buffer requiring
owner-approved recovery. Public identities, final upload messages and live fees
must be rechecked before approval. Keeper operation, later launches, liquidity
contributions and independent review are additional costs.

Sources: [Base fee components and L1 oracle](https://docs.base.org/specifications/transactions/network-fees),
[Solana deployment and authority rules](https://solana.com/docs/core/programs/program-deployment),
[pinned loader buffer funding behavior](https://github.com/anza-xyz/agave/blob/v3.1.10/programs/bpf_loader/src/lib.rs).

## Release blockers for both chains

1. Independent security/economic review of the new engines, supply choices and
   Mayhem impact on user liquidity. Commit/reveal is not a VRF: a controller can
   censor/selectively withhold reveals. Finite expiry budgets limit attempts;
   they do not remove that trust or block-producer influence.
2. Approved public controller identity and an operating keeper with authenticated
   signing, persisted commitment/recovery handling, bounded fees, monitoring and
   demonstrated Auto/Manual execution. Solana currently constrains the controller
   to the build's fixed treasury; reusing a financial treasury as a keeper requires
   explicit security review or a separate reviewed controller build.
3. Approved Base constructor identities/limits; new Solana public program ID,
   rebuild, upgrade-authority policy and final release hashes. No signing files
   should be supplied to this agent.
4. Review and activation of staged V6 discovery/website routing that retains every V2 and Solana legacy
   market and routes each to its correct adapter. Simply replacing the live
   factory/program address is unsafe. The current live configuration intentionally
   rejects V6 activation.
5. Separate design/review/approval if external DEX liquidity or automatic migration
   is wanted. Current real curve backing is not a Uniswap/Raydium pool.
6. User approval of exact security results and refreshed deployment/operating costs.
   No deployment, production merge, live switch or spending is authorized yet.

Readiness: both candidates are suitable for further review and local integration;
neither is approved or fully ready for mainnet production.

## PR #28 cost-first continuation

Base takes priority. `web/base-version-router.js` is a staged, separately bundled
integration: it keeps the exact live V2 factory, maintains both discovery cursors,
routes from freshly verified factory provenance rather than displayed version
labels, rejects ambiguous ownership/substitutions, and blocks V6 writes unless
explicitly approved by the future reviewed activation path. Real V2 and V6 website
adapters are exercised together against real local contracts. The production app
does not import this module, and live configuration/Pages assets are unchanged.
Its integration into actual live Create/detail pages remains a release task.

`scripts/base-v6-keeper-plan.mjs` produces unsigned, zero-value intents from one
block-consistent snapshot. It verifies Base/version/controller/registration,
honors creator Manual requests, cooldown, pauses, future-block reveal, recovered
secrets, expiry and finalization, and checks gas plus an L1 oracle upper bound
against explicit fee limits. Auto/Manual plans are executed only in a local EVM
test, including missing-secret restart recovery. This is not a deployed keeper:
an independently reviewed durable journal, signing service, locking/idempotency,
nonce management, reorg handling, actual receipt accounting and monitoring are
still required. A supplied `secretDurablyStored` flag is a caller assertion, not
proof of persistent storage. Never sign an intent before fresh verification and
approval of the exact runtime/controller. The engine's finite attempts limit
does not by itself cap cumulative keeper fee spending.

Solana build-only `opt-level=z` reduces the ELF from 343,912 to 311,360 bytes
(32,552 bytes, 9.465%). `no-idl` disables unused on-chain IDL administration;
product instruction discriminators, account layout, trading, metadata, checked
math, events, supply protections and Mayhem remain unchanged. The full 35-test
actual-SBF suite passes, including max-metadata compute-budget execution. Rust
dependencies and legacy build settings are unchanged. Exact-size retained rent
falls from 1.74878492 to 1.58342076 SOL; the 900-byte upload scenario falls from
1.75071992 to 1.58517076 SOL including ordinary fees. These are estimates.

Further size reduction by removing Token-2022 helpers from Anchor's mint-init
dependency path or rewriting account initialization/serialization requires
additional security-sensitive changes. Those were not made to chase rent savings.
The Agave build warns that a dual cdylib/lib crate precludes LTO; changing the
library/build architecture also needs separate reproducible build and VM review.
Overflow checks and essential instructions are retained. Do not use a larger
default allocation just for convenience: doubling this candidate's allocation
raises retained rent to 3.16512956 SOL. Future extensions require later approval.

Cheapest safe sequence: preserve existing mainnet programs; finish Base V6
review/keeper/website release first; defer Solana V6 entirely until its benefit
justifies ~1.58517 SOL plus review/operation. Do not replace or repurpose the
existing Solana program to save rent: the new layout and PDA namespace are not
a proven backward-compatible upgrade. The user's Solana V3 label is not used as
an activation identity; the preserved public program ID is the identity recorded
in config.json. Auto/Manual still require real voluntary backing/bank funding;
the planner never supplies funds. Independent audit and external DEX migration
remain separate work/costs.
