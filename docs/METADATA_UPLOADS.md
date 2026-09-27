# Metadata upload deployment candidate — NOT deployed or enabled

## Source and existing RPC

`workers/pumplite-rpc/worker.js` is based on the complete temporary Worker source supplied by the owner, with the previously supplied production response-forwarding/10-second-timeout replacement. No Worker source or deployment automation previously existed in this repository. This is a local candidate, not a downloaded or attested copy of the currently deployed Worker. Compare against the live dashboard source before approving replacement.

The original exact PumpLite origin, RPC method allowlist (including simulation but not broadcasting), 100,000-byte request limit, batching prohibition, health route and RPC preflight are retained. Only the two metadata routes have Authorization added to their allowed request headers. No frontend CSP changes are needed because the same Worker origin is already allowed. Neither a Pinata host nor a wildcard is added to browser CSP.

## Current Pinata interface

Authoritative API schema checked 2026-09-27:
https://github.com/PinataCloud/docs/blob/main/pinata-api-v3-uploads.yaml

The fixed destination is POST https://uploads.pinata.cloud/v3/files. Authentication uses the server-side bearer credential, file is multipart, network is explicitly public, and the returned CID is read from data.cid. The documented permission is org:files:write. Keep the existing restricted Pinata credential in the Cloudflare secret; do not paste, export, alter, log or commit it. Verify its permissions privately in the provider dashboard. No signed upload URL or provider response is returned to browsers.

## Fail-closed deployment and abuse gate

Uploads remain unavailable unless METADATA_UPLOADS_ENABLED is exactly the string true, the existing Pinata secret is present, AND an UPLOAD_GUARD service binding exists. The checked-in config keeps the flag false and does not invent a binding. /health and /rpc do not depend on metadata configuration.

The guard is NOT implemented, provisioned or tested against a real Cloudflare service in this task. This intentionally prevents an unrestricted upload relay. An external authorization/quota service must be reviewed and configured before activation. Do not substitute an always-allow stub, static browser key, in-memory counter, or Origin-only check. Origin headers are forgeable outside browsers. Free-tier infrastructure eligibility and quotas must be verified in the owner's account; no paid service is requested.

Required service contract:
- An authenticated issuance flow creates a short-lived, single-use upload grant. No Pinata/Helius credential may serve as that grant. No issuance flow or active upload UI is currently exposed.
- POST /authorize receives the grant in Authorization and JSON {path,bytes,sha256,imageCid?}. Return 204 only after atomic grant consumption, per-user/global byte and request quotas, expiry, route and body-digest verification. Reject replay/concurrency and absent/invalid identity. For JSON, verify that imageCid is a completed image owned by that identity. Reserve quota before authorizing; do not refund uncertain/time-out attempts automatically.
- POST /complete receives the same grant and {path,sha256,cid}. Verify it matches the already-consumed authorization; atomically persist the upload receipt/ownership and return 204. Never accept an unauthenticated caller at this service. Service-binding access itself must be restricted to this Worker.
- A lost Pinata response or failed receipt may leave an orphan pin. There are no retries. An operator reconciles quota and pin records privately; do not automatically retry and duplicate uploads.

Durable atomic quotas and grant issuance cannot be simulated with Worker isolate memory or claimed present because this interface exists. Rate-limit malformed/unauthenticated traffic at the edge as well; body/CPU bounds alone are not account-wide abuse protection. No paid uploads or live uploads were performed.

## API and content restrictions

POST /metadata/image accepts raw image/png, not multipart, SVG, URLs or filenames. Limit: 512 KiB. PNG requires valid chunk CRCs, one IHDR, complete IDAT/IEND, no trailing bytes, no animation/text/profile chunks, 8-bit noninterlaced RGB/RGBA, maximum 1024 x 1024 pixels, bounded zlib decompression, exact scanline length and valid row filters. Other PNG exports must be re-exported as plain RGB/RGBA. This validates structure and bounded pixel data, not visual moderation or an independent image-decoder audit. Generated filename: token-logo.png.

POST /metadata/json accepts at most 4096 bytes and exactly name, symbol, description, imageCid. Name is nonempty and at most 32 UTF-8 bytes; symbol is 1–10 uppercase ASCII letters/digits; description is at most 2000 UTF-8 bytes. Control characters, unknown fields and arbitrary image URLs are rejected. The server generates {name,symbol,description,image:'ipfs://CID'}; user text stays inert JSON. Generated filename: token-metadata.json. No external URLs are fetched from input.

Requests have a 15-second total timer including request body, guard, Pinata response and receipt; upstream responses are bounded to 8192 bytes. Unexpected/upstream errors are generic and do not include response bodies, exception text or credentials. Success returns only {cid,uri}. Use canonical ipfs:// URIs independently of a display gateway. Public IPFS uploads are public and deletion cannot guarantee erasure. Pinning continuity, backups and wallet display checks remain operational responsibilities. Base URI storage alone does not guarantee wallet discovery.

## Frontend preparation

web/metadata-upload.js is a prepared, tested client helper. It is deliberately not connected to an active upload button or bundled into the live app until the authorization flow and guard are provisioned. It rejects uploads without explicit enabled:true, takes only a short-lived grant held in memory, fixes the endpoint to this Worker, and never stores credentials or requests wallet access. Its timeout/response-size limits use the existing bounded fetch helper. Existing local metadata JSON download remains available. No frontend config flag is enabled and no wallet implementation is changed.

Upload and on-chain creation are separate operations. A future UI must explain public storage, request explicit upload consent, receive a scoped grant, upload the image then JSON with separate grants, and show the canonical metadata URI. It must retain the independent on-chain deployment/transaction gates. Do not expose a secret as an expedient replacement for authorization.

## Manual Cloudflare action — requires separate approval

No workflow deploys this candidate. Locally generate a single module with:

    node scripts/build-worker.mjs

After separate approval, compare the deployed source against this candidate, then paste build/cloudflare/worker.js into the existing pumplite-rpc Worker editor (ES-module syntax). Preserve its existing server-side secrets without displaying or editing their values. Keep METADATA_UPLOADS_ENABLED unset or false; no UPLOAD_GUARD binding means uploads still fail closed. Preserve all existing routes/domain/security settings. Do not deploy the candidate automatically from CI.

After approved manual deployment, verify /health and one read-only getGenesisHash through /rpc with the expected origin; confirm uploads return unavailable while disabled. Activation requires the separate real guard/auth/quota work above and owner authorization for a tiny real Pinata upload. Do not interpret mocked tests as successful Pinata credentials, durable pinning, or Cloudflare runtime validation. Keep Solana/Base creation and trading disabled.
