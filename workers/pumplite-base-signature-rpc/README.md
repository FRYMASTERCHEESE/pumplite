# Private Base signature RPC — local candidate, not deployed

This Worker is intended solely as `BASE_SIGNATURE_RPC`, an HTTP service binding from `pumplite-upload-guard`. No existing Worker or production binding is changed by this directory.

## Private ingress

`workers_dev: false`, `preview_urls: false`, and `routes: []` are explicit. Do not add a custom domain, route, preview or public endpoint. Browser Origin headers are rejected; no CORS permission is returned. Cloudflare binding/routing configuration is the access boundary: an Origin header or incoming hostname is NOT an authentication mechanism. Account operators must authorize only the upload guard to bind to this service. Anyone permitted to change Cloudflare account configuration is outside this application boundary.

After separately approved deployment, the guard would use this service entry (NOT added or activated by this task):

    { "binding": "BASE_SIGNATURE_RPC", "service": "pumplite-base-signature-rpc" }

Do not set ISSUE_ENABLED or any metadata-upload flag as part of RPC provisioning. Existing issuance/deployment gates remain independent.

## Upstream selection and existing fallback

`BASE_RPC_URL` is optional server-side configuration, never accepted from the request. If provided, it must be HTTPS without userinfo or a fragment. If an operator later uses a credential-bearing provider URL, store it as a Cloudflare secret, never in this repository or a browser; do not log or expose it. No actual upstream credential was requested or accessed here.

With no configured URL, this candidate returns 503 by default. An operator can separately opt in with the literal string `ALLOW_PUBLIC_BASE_RPC=true` to use the fixed public https://mainnet.base.org endpoint. Checked-in config explicitly keeps this false. Invalid configured URLs never fall back. There is no automatic failover on HTTP failure, timeout, malformed response or wrong chain; there are no retries.

The upload guard's pre-existing direct public Base endpoint remains unchanged when it has no service binding. Once a binding exists, the guard uses that binding and does not bypass it on failure. This candidate additionally verifies Base chain ID 8453 before each individual method, with no cached chain approval. The existing guard also verifies chain ID before contract verification. Both checks fail closed. Chain ID is a trusted-RPC identity check, not cryptographic proof of honest chain data. Public endpoint capacity is not guaranteed and production quotas/monitoring remain an operator responsibility.

## Request and response policy

POST `/` only; strict JSON content type; exactly jsonrpc, id, method and params. Batch arrays, notifications, unknown fields, arbitrary URLs, state overrides and extra call fields are rejected. Only:

- eth_chainId: no params.
- eth_blockNumber: no params.
- eth_getCode: address plus explicit canonical block-height quantity.
- eth_call: address, canonical ERC-1271 isValidSignature(bytes32,bytes) calldata and gas between 1 and 500,000, plus explicit block height. No from, value, state overrides or other selectors. Contract signatures are bounded to 512 bytes and ERC-6492 wrappers are rejected.

Signing, transactions, wallet/admin/debug/trace and all other RPC methods are rejected before any upstream request. eth_call executes only a read-only RPC simulation and cannot persist state or spend ETH. It does not guarantee that an arbitrary contract implementation internally obeys Solidity view semantics; it sends no transaction. The guard still decides signature validity from the exact magic value.

Limits: 4,096-byte request, 65,536-byte upstream and client response, 8-second overall deadline including streamed bodies, at most two upstream requests per incoming request. JSON-RPC upstream IDs, result envelopes and result types are verified. Manual redirect handling rejects all redirects. Upstream headers, error bodies, exceptions and provider URL are never returned or logged. Only bounded result data or generic errors are returned, with no-store headers. No keys, accounts or signing code exists in this Worker.

## Local checks only

From this directory:

    node --test worker.test.mjs
    npm exec --yes --package=wrangler@4.142.0 -- wrangler deploy --dry-run --config wrangler.jsonc --outdir dry-run

Tests mock every upstream request, including the existing upload guard's ERC-1271 service-binding flow. No live RPC, wallet, secrets, funds or contract deployment are needed. `--dry-run` is mandatory; this task does not authorize deployment. Generated .wrangler and dry-run output and local secret files are ignored.

Cloudflare references checked 2026-09-28:
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
