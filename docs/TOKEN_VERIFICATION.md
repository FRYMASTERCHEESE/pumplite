# PumpLite identity and provenance reviews

Status date: 1 October 2026.

The active public Base V2 factory is `0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4`. The older Base V1 factory
`0xf722BeD94c4A41B2C71cDCDEB5EEA062352aEe44` remains a separate historical deployment. Solana remains
undeployed and transaction-locked.

## What the labels mean

"Created on PumpLite" requires a live Base chain-ID check and registration in the configured official factory.
The label is derived from on-chain provenance, not from token metadata, a URL or a local label alone.

"Verified by PumpLite" is an identity/provenance review. It is not an investment endorsement, security audit,
price promise or guarantee of liquidity. A verified entry must still match current on-chain market/token identity.
Portable Base review attestations use the PumpLite EAS review schema where configured, and the published
`web/verified-tokens.json` registry remains the website's reviewed mirror.

PLITE is the reviewed PumpLite project token currently recorded by the public registry. Removing or changing a
review must fail closed rather than leaving a stale verified state.

## Review workflow

The maintainer must inspect the actual project and metadata before publishing a verification decision:

1. Check the Base V2 market is registered by the active factory.
2. Confirm market, token, creator, name, symbol and metadata URI against the live chain.
3. Inspect supplied website/social/media identity for obvious conflicts or impersonation.
4. Publish/reconcile the portable Base review proof where required.
5. Run the repository build/check/test/Pages/browser gates before publishing the registry mirror.

The GitHub "Review PumpLite token identity" workflow validates the supplied market, EAS UID, decision and explicit
confirmation before rebuilding/testing the published registry mirror.

Review notes are public. Do not put private or sensitive information in them.

## Creation and metadata

Base V2 creation supports Fixed / No Mint and permanently capped Mintable launches. There is no creator allocation
minted directly to a wallet by the V2 launch flow. If a token was launched as mintable, its creator can add inventory
only into that PumpLite market, only up to the immutable lifetime maximum, until minting is permanently locked.

Token images selected for in-app publishing are locally normalized before upload. Metadata publication uses
wallet-signed authorization and canonical IPFS URIs. Remote token media is not automatically fetched simply because
a creator supplied a URI.

Identity review and metadata publication are separate from investment merit and separate from contract security.
