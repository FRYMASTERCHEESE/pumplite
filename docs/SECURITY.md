# Security boundaries and release gates

This is an unaudited local implementation, not an approval to deploy.

## No privileged fund controls

No owner/admin, mutable treasury/fees, mint-after-launch, freeze, pause, upgrade proxy,
market editing, reserve withdrawal, or donation-rescue function exists.
The Solana loader's deployment authority is separate from program instructions:
a future deployment must use an explicitly reviewed immutable deployment/finalization policy.
Do not leave a retained upgrade authority able to replace the fund-handling program.
No deployment or authority-change transaction has been prepared or submitted.

Never request, export, log, store, or commit wallet seed phrases or private keys.
Public treasury addresses are intentionally present. Test signing material stays inside the ephemeral test VM.
Ignore patterns are defense in depth, not a replacement for reviewing staged files.
No wallet credentials are required by CI.

## Verified local foundation

The current local build uses Anchor 1.0.2 with explicit System Program address constraints.
The user confirmed the preceding commit passed Solana verification #2, Local verification #5
and Pages deployment #32. Those runs do not validate these newer uncommitted changes.
Current evidence: 4 host tests, actual SBF compilation, IDL/schema verification and 24 runtime tests,
including frontend-built instructions, maximum metadata/packet/compute checks, 384 seeded four-user
trades and a System Program substitution regression. See
[READINESS_FOLLOWUP.md](READINESS_FOLLOWUP.md) for exact results and limits.
This is a local verification gate, not Mainnet approval.

The frontend full genesis-hash blocker is now fixed and covered by seven loopback-only regression
checks plus published-bundle validation at mobile/desktop widths. Both configuration and RPC
responses must exactly match the pinned Mainnet hash; truncated references and RPC failures are
rejected. Identity is rechecked rather than cached. Transactions remain disabled and deployment
addresses remain null. A genesis response alone cannot authenticate a malicious RPC or establish
wallet interoperability; those release gates remain.

## Required before Mainnet deployment

1. Obtain explicit user approval for any eventual deployment; the current task authorizes local work only.
2. Reproduce the pinned host/SBF/IDL/runtime checks in the clean Linux CI environment and review Cargo.lock.
   The reviewed ABI and actual client-built create/buy/sell instructions now execute in the local SBF harness.
3. Extend the seeded multi-user suite into broader fuzz campaigns, integer-extreme and production feature-set testing; maximum metadata, packet and compute bounds now have local coverage. Keep the signer, PDA, CPI, reserve, fee,
   slippage, liquidity and atomic rollback regression tests passing.
4. Independently audit both contracts and the client transaction construction. Extend fuzz/stateful testing,
   economic analysis, sandwich/MEV analysis, tiny-trade fee behavior, full-inventory round trips and long sequences.
5. Review fixed supply, 30 SOL/1 ETH pricing offsets, 25 bps treasury-only fee, donation locking,
   no migration/graduation, and dust behavior as product decisions. These are not adjustable after launch.
6. Confirm treasury ownership and ability to receive native payments without requesting any credentials.
   A reverting Base treasury halts trades; wallet fee estimates need production verification.
7. Verify immutable bytecode/program artifacts, exact compiler settings, source, treasury constants, and chain IDs.
   The current Solana program identity is only inherited build configuration, not proof of a deployed artifact.
8. Complete real wallet interoperability and mobile-device checks, transaction replacement/timeout/rejection handling,
   RPC outage and rate-limit handling, and account/network-change tests using a safe local harness first.
9. Decide how to publish immutable Solana token metadata recognizable by wallets.
   The current market metadata alone does not register Metaplex metadata.
10. Resolve dependency audit findings and review the pinned toolchain/actions for release.
    Verify the separate Solana runtime CI result for the exact release commit; green web/Pages CI is insufficient.
11. Configure production RPC capacity without exposing secrets. Update CSP for reviewed RPC hosts,
    serve compressed assets with appropriate immutable caching, enforce HTTPS and server-side security headers,
    and use a bounded discovery service when Solana market enumeration becomes large.
12. Resolve the inherited LICENSE placeholder and publish accurate fee/risk/authority disclosures.
13. Only after reviewed deployment, verify actual deployed code/immutable authority, populate public addresses,
    review the frontend deployment lock and enable writes as a separate explicitly approved release.

## Dependency observations

Runtime dependencies are pinned and browser-bundled. Dependency scans cover packages, not contract correctness.
The local test VM has older native optional dependencies; it is not shipped in the website or exposed as an RPC service.
Current scans are recorded in READINESS_FOLLOWUP.md; IMPLEMENTATION_REPORT.md retains historical observations. Never silence an advisory merely to make CI green.

## Product data

No hardcoded balances, prices, market lists, transactions, or volume.
Empty/unconfigured/error states must remain empty/unavailable.
Test fixtures are confined to tests and never bundled into the product.
User-controlled text is rendered with textContent; metadata URI contents are not rendered.
Do not enable production features by replacing failures with example data.
