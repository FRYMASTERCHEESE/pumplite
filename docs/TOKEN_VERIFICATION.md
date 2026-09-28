# PumpLite identity and provenance reviews

The deployed Base V1 LaunchFactory remains 0xf722BeD94c4A41B2C71cDCDEB5EEA062352aEe44.
No contract, economics, treasury or wallet-connect implementation is replaced. Solana remains locked.

## Two independent labels

Created on PumpLite requires a fresh Base chain-ID check and the configured official factory's
isMarket(market) result. The Base adapter records the exact factory, market and block with its
chain-read snapshot. No badge is granted from token metadata, URLs, local storage or a review entry alone.

Verified requires an explicit status: verified entry in web/verified-tokens.json AND matching
current on-chain market, token, creator, name and symbol. Helper-produced entries also bind the
metadata URI. A missing, invalid, future-dated or unavailable registry grants no Verified badge.
An entry removed from the published registry loses its badge on the next refresh/load/filter check.
Already-open offline pages cannot receive immediate revocations; the UI is an observed snapshot,
not a continuous monitor. Refresh before relying on a label. There is no automatic expiry policy.

Verified means PumpLite reviewed the token's identity/provenance. It is not an endorsement,
safety guarantee, price promise, investment recommendation or security audit.

## Owner workflow (read-only chain calls)

Run from the repository root in an interactive terminal:

    node scripts/verify-market.mjs verify <market-address> [note]

The helper uses the configured Base read RPC and fixed official factory. It checks chain 8453,
factory registration, reads market/token/creator/name/ticker/metadata at one block and displays
those public details. It does not request a wallet, signature, private key, transaction or gas.
Only the local registry is written; the chain access is read-only.

The maintainer MUST inspect the actual project and metadata before answering yes to each prompt:
1. Rule out obvious impersonation of another token/project.
2. Manually inspect every supplied website/X/Telegram/Discord link for project consistency.
3. Inspect name, ticker, description, image and optional banner for presence and consistency.
4. Resolve conflicting or duplicate identity details that could make the label misleading.

The helper does not pretend to automate those judgments. It refuses noninteractive approval,
missing metadata and incomplete confirmations. Cancel without confirming if review is unfinished.
Never run it as an unattended auto-verifier. Repository write/review permissions control who can
publish a badge; no public admin page or privileged contract function exists.

To revoke locally (no RPC needed):

    node scripts/verify-market.mjs remove <market-address>

Review the diff, run build/check/test/Pages/browser checks, then publish the reviewed change.
The build validates and copies the file to assets/verified-tokens.json in both root Pages and dist.
Keep any investigation records free of personal/sensitive material; note is public and plain text.
The registry starts empty: no actual project received a review during implementation.

## Creation and media

The one-page form retains the fixed one-billion supply, 0.25% trading fee and Base ETH curve.
Wallet approval and gas estimation still use the existing Base adapter/factory. No transaction
is retried automatically. Links are inert validated HTTPS project URLs; we never fetch them.
Uploaded images are locally normalized to plain PNG within the existing dimension/byte limits.
Previewing an image is local and requires no signature. Banner support is a public HTTPS/IPFS
URI; banner file upload is not offered by this version. Remote token media is not auto-fetched
on cards/pages, preserving CSP, mobile data limits and avoidance of untrusted URL fetches.

Descriptions, links or media must have a metadata URI before creation, so they cannot be silently
discarded. Editing fields after a successful in-app publish clears its stale URI. An independently
pinned/manual URI must be checked by the creator; the UI does not claim to inspect its contents.

## Upload compatibility and required external rollout

Existing basic image/name/symbol/description uploads preserve their exact canonical JSON bytes.
Extended links/banner support is additive in the candidate RPC Worker's metadata handler.
The exact-origin GET /metadata/capabilities endpoint advertises version 2 and fields links/banner.
No RPC method, upstream secret, quota, grant, image ownership or authorization rule is changed.
No CORS origin or CSP destination is broadened. No Worker was deployed by this task.

Before requesting ANY upload signature for extended metadata, the frontend requires that capability.
An older/unavailable Worker therefore fails safely, with an instruction to download the complete
metadata JSON, pin it independently and enter its URI. It never silently drops project fields.
The owner must separately approve/deploy the tested Worker candidate before in-app extended
publishing is available. Existing basic publishing remains compatible in the meantime.

Social fields serialize as external_url (website) and extensions (website/twitter/telegram/discord);
banner is an optional top-level URI. Client and Worker share normalization and canonical ordering,
and the signed digest includes all added fields. The 4096-byte metadata limit is unchanged.

## Deferred, not simulated

No V2 deployment, USDC/custom pair, reward routing, launch boost, altered supply or curve mode.
No live creation/trade/upload acceptance was performed. Mainnet wallet acceptance and any
Worker rollout remain owner actions; neither local tests nor badges constitute an audit.
