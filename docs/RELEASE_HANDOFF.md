# Offline release handoff (no deployment)

Use the successful CI run for the exact owner-approved full commit SHA. Download and retain both base-verification and solana-verification archives before their 30-day expiry. Extract each into a separate empty directory. The release-CHAIN.json manifest is at the extraction root; its artifact paths must remain intact.

From a reviewed checkout, with Node installed, run:

```
node scripts/release-package.mjs verify base /absolute/path/to/base-package FULL_APPROVED_COMMIT_SHA
node scripts/release-package.mjs verify solana /absolute/path/to/solana-package FULL_APPROVED_COMMIT_SHA
```

These commands read only the supplied public artifacts. They do not access wallets or perform RPC, signing or deployment. Verification fails on missing, changed, duplicate or unexpected paths, a different commit, noncanonical/dirty profiles, changed treasury declarations, or inconsistent Solana IDL identity. Digests establish integrity relative to the manifest, not authenticity: obtain the archive from the trusted successful GitHub run and compare its full commit independently. An attacker replacing the manifest and files together is outside this integrity check. Hash matching does not establish independent audit approval, economic safety or actual on-chain code identity.

The canonical profile remains Ubuntu 24.04 x86_64 with the pinned CI toolchain. Windows artifacts are local test outputs, not canonical deployment candidates. Base includes self-contained Solidity standard input for explorer/source verification; Solana includes SBF, IDL, lockfile, metadata fixture provenance, reproducibility and dependency evidence. A separate deployment approval remains mandatory. Do not submit a deployment merely because these commands pass.

## External provisioning checklist

Before deployment approval, choose the final public Solana identity, prove treasury custody outside this repository, and have an independent reviewer examine contracts, economics and documented dependency exceptions. Any program-ID change requires rebuilt/reverified canonical artifacts.

Provision monitored RPC capacity with browser CORS and a verified independent fallback. The current public endpoint fallback is not an SLA. Do not put private provider credentials in Pages configuration. Configure a host that actually emits the reviewed HTTP security headers; GitHub Pages ignores _headers. Test provider outages and header behavior on the actual origin.

For immutable metadata, retain the exact JSON/image bytes and content hashes, use content-addressed IPFS URIs where feasible, and arrange redundant pinning with monitoring and a backup export. A CID alone does not guarantee persistence. Verify metadata reads from independent gateways and the intended wallets before creating an immutable market. PumpLite's local JSON helper neither uploads nor pins content; no durable hosting service has been provisioned. Base contract metadata URI storage alone does not guarantee wallet discovery/display.

After a separately approved deployment, compare deployed executable/runtime bytes (including Base immutable constructor values), confirm authorities and treasury routing, publish verified source, then perform separately approved small funded-wallet acceptance. No such actions have occurred in this task. Leave trading disabled until that evidence is reviewed and activation is explicitly approved.
