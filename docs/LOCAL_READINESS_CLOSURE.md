# Local readiness closure — 2026-09-27

This report supersedes the remaining-local-work sections of RELEASE_CANDIDATE.md. Trading remains disabled; neither chain has a verified deployment. Local tests do not constitute an independent audit or Mainnet acceptance.

## Changes and verification

Immutable Solana fungible metadata is now created through the fixed Metaplex program before mint authority revocation. The market PDA retains immutable metadata update authority. The pinned public Metaplex executable is a runtime compatibility fixture, not independently source-verified deployment evidence; its provenance and original third-party license are retained under tests/fixtures/metaplex.

The completed verification passed 4 Rust host tests, 29 compiled Solana runtime tests, and 64 JavaScript tests (Base contract/frontend integration, accounting, adversarial operations, gas, RPC, network identity and transaction lifecycle). New runtime cases verify immutable metadata and atomic rollback for substituted metadata accounts/programs and failed CPI. IDL generation and the nine-account create instruction schema check passed. Base compilation/source-bytecode checks passed. Static GitHub Pages exports and preview checks passed at 390px and 1440px, including SDK loading, disabled writes, headers, frame blocking, local JSON download and absence of wallet calls. Syntax, deployment locks, generated asset freshness and workflow lint passed; ShellCheck was unavailable. A Windows reproducibility attempt initially failed because the invocation pointed at the wrong SDK library directory; the corrected invocation is recorded in the local build log.

Frontend additions include bounded RPC requests (no automatic transaction retries), actual Solana signature validation, Base gas estimation with limits, optional paged discovery, mobile wallet browse links and local metadata JSON generation. These are synthetic/browser-tested; real-device wallet acceptance remains external.

CI uses Ubuntu 24.04 x86_64 as the canonical release profile, pinned compilers and independent-directory SBF reproduction. Release manifests bind public artifacts to the commit and hashes. Windows and Linux binaries are not asserted identical. Archive the successful canonical CI artifacts before their 30-day retention expires; do not deploy a locally rebuilt binary under a different profile while claiming the CI hash.

## Dependency review

The refreshed policy check accepts one explicitly scoped JavaScript moderate advisory (stream-json) and six Rust informational warnings documented in dependency-review.json. No RustSec vulnerabilities were returned for 385 locked registry packages. Only bincode from that informational set is in the program's normal/build dependency graph; the others are tooling/runtime dependencies. The vulnerable JavaScript module is excluded from shipped bundles. These are reviewed exceptions, not a claim of zero dependency risk. Review expires 2026-12-22; changed, new or expired findings fail verification. Do not force incompatible transitive upgrades to hide warnings.

## Production infrastructure and discovery

Provision HTTPS Solana Mainnet and Base Mainnet RPC service with browser CORS, quotas, monitoring and reliable finalized reads. Public browser configuration cannot contain secret provider credentials. Confirm the full Solana genesis hash and Base chain ID 8453, then load-test actual provider limits. RPC calls are limited to 15 seconds and 1 MiB; oversized discovery responses fail closed.

For larger Solana catalogs, an operator can collect a finalized read-only getProgramAccounts snapshot filtered to PumpLite market accounts. Save public JSON with programId, genesisHash, slot and keys (account address strings); run `node scripts/build-discovery-index.mjs snapshot.json`. Publish the generated build/market-index/solana directory atomically over HTTPS and configure discoveryUrl to its directory URL. Refresh periodically with monitoring; retain snapshot slot and avoid mixing pages from different snapshots. The client revalidates each market on chain and never takes prices/reserves from the index. Completeness and availability of the operator's index remain operational responsibilities. The fallback is bounded to 4096 keys. No index is currently published/configured.

_headers and ops/security-headers.conf provide HTTP policies for compatible static hosts or Nginx. GitHub Pages ignores these files: applying the complete policy requires a configured fronting service or compatible host. Meta CSP and the application frame guard provide local defenses but are not equivalent to response frame-ancestors. Validate actual HTTPS responses, CORS, CSP and caching on the production origin; Nginx configuration has not been tested with a running Nginx server.

## Owner and independent release gates

1. Obtain an independent contract/economic/frontend review, including the immutable curve design, metadata CPI dependency, advisory exceptions, and license obligations. Resolve its findings before any deployment.
2. Choose and attest the public Solana deployment identity and deployment authority policy. The checked-in ID is a build identity, not proof of ownership. If changed, regenerate IDL/frontend configuration and repeat canonical build/runtime checks. Arrange final immutable program deployment (authority removal verified publicly); no application admin controls exist. Base contracts have no upgrade/admin withdrawal mechanism.
3. Verify ownership and intended custody of both fixed treasuries out of band: Solana BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct and Base 0x0de7fdcc798f7fac6b03b366c529133a9c60794d. Never provide secrets to this repository or agent. Independently compare these public addresses with compiled artifacts before approval.
4. Provision and validate production RPC/index/headers infrastructure and durable metadata/image hosting (HTTPS or IPFS). The local JSON helper does not upload or pin. Solana metadata is immutable: verify content and persistence before creation. Test Phantom and MetaMask browse links, connection/rejection/disconnect/chain switch and accessibility on actual supported iOS/Android devices.
5. Explicitly approve deployment separately. After approved deployment, verify Solana executable identity, bytes and revoked upgrade authority; verify Base runtime bytecode including immutable constructor values and publish matching source/compiler settings. Confirm fixed treasury routing and token authorities on actual chain accounts. Archive deployment receipts and canonical artifact hashes.
6. Conduct separately authorized, tightly limited real-wallet acceptance: create/buy/sell, approval/reset, rejected/expired/dropped/replaced transactions, RPC outages, actual treasury receipts and Base execution plus L1 data fees. Local gas estimates are not a Mainnet fee guarantee. Keep transactionsEnabled false until all acceptance and review evidence is approved.

Both implementations are candidates for independent review and owner deployment planning, not Mainnet-ready products. No real-device, deployed-code, treasury-receipt or independent-review checks are claimed passed.

Corrected independent-directory Windows SBF reproduction passed: SHA-256 9d7d1ded63b31cbbe35ba698e5533832788d9766764f2d5d196ae71ab8fdcf87. The Windows post-processing syscall warning persists; the actual binary passed all 29 SVM runtime tests. Canonical Linux evidence is produced by the pushed-commit workflow.


## Latest owner acceptance and artifact update

The owner subsequently reported successful Android Phantom connection with Mainnet RPC verification and successful Base wallet connection. Those connection-only checks are accepted as owner-reported results; they do not establish transaction, treasury receipt, other-device or deployed-code acceptance. The current work leaves wallet implementation unchanged.

Release archives now preserve exact manifest-relative paths, include all referenced files plus hashed verification evidence, and are checked offline before CI upload. See RELEASE_HANDOFF.md. Previous archives predate this packaging fix and should not be described as self-contained.
