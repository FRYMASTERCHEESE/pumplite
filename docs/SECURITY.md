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

## Required before Mainnet deployment

1. Obtain explicit user approval for any eventual deployment; the current task authorizes local work only.
2. Compile Solana host and SBF targets with a reviewed pinned toolchain. Generate/review Cargo.lock.
   Check the generated IDL against account layouts, instruction data, and account ordering in the browser.
3. Add and run local SVM integration tests for market creation, both authority states, wrong signer,
   substituted treasury/mint/vault/trader ATA/token program, duplicate/aliased accounts, rent preservation,
   depleted inventory, failed CPI rollback, donations, deadlines, integer boundaries, and repeated adversarial trades.
   Existing Rust math tests and JS model tests are not substitutes for actual SVM execution.
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
10. Resolve dependency audit findings, pin CI actions/toolchains for a release, add a Solana runtime CI job,
    and verify the CI workflow itself. No remote CI has been run.
11. Configure production RPC capacity without exposing secrets. Update CSP for reviewed RPC hosts,
    serve compressed assets with appropriate immutable caching, enforce HTTPS and server-side security headers,
    and use a bounded discovery service when Solana market enumeration becomes large.
12. Resolve the inherited LICENSE placeholder and publish accurate fee/risk/authority disclosures.
13. Only after reviewed deployment, verify actual deployed code/immutable authority, populate public addresses,
    review the frontend deployment lock and enable writes as a separate explicitly approved release.

## Dependency observations

Runtime dependencies are pinned and browser-bundled. Dependency scans cover packages, not contract correctness.
The local test VM has older native optional dependencies; it is not shipped in the website or exposed as an RPC service.
Track exact audit results in IMPLEMENTATION_REPORT.md. Never silence an advisory merely to make CI green.

## Product data

No hardcoded balances, prices, market lists, transactions, or volume.
Empty/unconfigured/error states must remain empty/unavailable.
Test fixtures are confined to tests and never bundled into the product.
User-controlled text is rendered with textContent; metadata URI contents are not rendered.
Do not enable production features by replacing failures with example data.
