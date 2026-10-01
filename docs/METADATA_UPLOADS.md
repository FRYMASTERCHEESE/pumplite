# Metadata uploads - current architecture and operational boundary

Status date: 1 October 2026.

The public PumpLite configuration currently sets `metadataUploads.enabled=true`, and the frontend exposes
wallet-authorized token image and metadata publishing. This document describes the checked-in client/Worker
contract. It does not expose or prove external provider secrets, account quotas or the current Cloudflare/
Pinata dashboard state.

## Browser flow

The frontend:

1. Accepts PNG, JPEG or WebP input.
2. Decodes and re-encodes the image as a bounded plain PNG.
3. Requests a short-lived authorization challenge for the exact upload digest.
4. Asks the connected wallet to sign the authorization message. This signature does not spend ETH.
5. Uploads the authorized image.
6. Creates canonical metadata using the returned image CID.
7. Requests a second wallet authorization for the exact metadata digest.
8. Uploads the metadata and returns canonical `ipfs://` URIs.

Upload and on-chain token creation remain separate operations. Publishing metadata does not create a token,
and creating a token still requires the normal wallet transaction and Base gas.

## Privacy and permanence

The selected image, token name, symbol, description and supported optional project fields are intended to
become public when published. The public wallet address and wallet-signed authorization are used to authorize
the upload. IPFS content can remain available after a website link changes and should not contain secrets or
sensitive personal information.

PumpLite never needs a wallet seed phrase or private key for metadata publishing.

## Client-side limits

The current client accepts PNG, JPEG and WebP input up to 12 MiB for local preparation, bounds decoded pixel
area, scales the image to at most 1024 pixels on its longest side, re-encodes it as PNG, and requires the final
PNG to fit the configured upload bound. Metadata text and JSON are also byte-bounded before publishing.

Remote creator media is not automatically fetched onto token cards merely because a metadata URI exists.

## Authorization boundary

The browser uses the PumpLite metadata authorization service for challenge/issue calls and passes a short-lived
Bearer grant to the upload route. Infrastructure provider credentials remain server-side and must never be
embedded in public JavaScript, committed to this repository or returned to the browser.

The repository can verify request construction, parsing, bounds and fail-closed behavior. It cannot prove that
the external Cloudflare service binding, provider secret, account quota or durable pinning is currently healthy.
Those are operational checks.

## External-service requirements

Maintain:

- exact PumpLite-origin restrictions where applicable;
- bounded request/response sizes and timeouts;
- replay-resistant, short-lived authorization;
- server-side provider credentials only;
- rate/quota controls appropriate to public usage;
- canonical IPFS CIDs/URIs returned to the frontend;
- no automatic retry that could duplicate uncertain uploads.

A failure in metadata publishing must not silently bypass authorization or enable a token transaction with
different metadata than the user reviewed.
