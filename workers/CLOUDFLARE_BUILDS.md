# PumpLite Cloudflare Workers Builds

PumpLite's Solana registry and Manual Mayhem backend use two existing Cloudflare Workers:

- `pumplite-upload-guard` — root directory `workers/pumplite-upload-guard`
- `pumplite-rpc` — root directory `workers/pumplite-rpc`

Both workers already contain their production names and bindings in `wrangler.jsonc`.

## Recommended production connection

Use Cloudflare Workers Builds with the GitHub repository `FRYMASTERCHEESE/pumplite` and production branch `main`.

Configure each existing Worker separately:

| Worker | Root directory | Deploy command |
| --- | --- | --- |
| pumplite-upload-guard | `workers/pumplite-upload-guard` | `npx wrangler deploy` |
| pumplite-rpc | `workers/pumplite-rpc` | `npx wrangler deploy` |

Deploy `pumplite-upload-guard` before `pumplite-rpc` when both change.

Do not put Cloudflare API tokens, account IDs, private keys, wallet seed phrases, or controller signer material in this repository. Cloudflare's GitHub integration should hold its own deployment authorization.

## Manual Mayhem release gate

After a worker deployment:

1. `https://pumplite-rpc.coreyedge123.workers.dev/health` must return `ok`.
2. The public RPC worker and upload guard must be deployed from the same reviewed `main` revision when launch-finalization code changes.
3. An already-finalized Solana activation must be recovered through `/launch/finalize`; never submit a second activation transaction just because registry synchronization is pending.
4. Manual Mayhem becomes triggerable only after canonical activation is registered and the original launch's Mayhem authorization matches the activated mint.

This repository intentionally contains no automatic fallback that can create or broadcast a replacement activation during registry recovery.
