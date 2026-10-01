# Additive feature upgrade

Status date: 2 October 2026.

This upgrade is intentionally backward-compatible. It does not remove an existing PumpLite feature, alter deployed contract addresses, change token economics, change Base transaction enablement, unlock Solana transactions, request a wallet signature, deploy a contract or spend funds.

## Improvements

- Cross-platform Pages reproducibility now pins `web/token-verification.json` and public identity/discovery files to LF line endings.
- The main site publishes richer social/search metadata and browser install metadata.
- The header and footer link directly to the existing PLITE verification evidence and the new public status center.
- `status.html` performs read-only public checks for Sourcify, DEX Screener, GeckoTerminal, Blockscout and PumpLite-published identity evidence.
- The status center includes safe copy/share controls for the official PLITE token address.
- `manifest.webmanifest` adds install/app metadata without a service worker. PumpLite deliberately does not cache wallet-critical network configuration or transaction state offline.
- `.well-known/security.txt` publishes a standard security-reporting route.
- `token-list.json`, `.well-known/plite-token.json`, `robots.txt` and `sitemap.xml` expose additional official discovery references.
- Reduced-motion and increased-contrast accessibility preferences receive explicit styling support.
- Static regression tests ensure no keys, private keys, wallet signing or transaction code enters the new read-only status layer.

## Verification boundary

Public indexing is not the same as a provider-controlled verification badge. The status center reports what public provider endpoints expose and does not manufacture badges, ratings, listing approval or investment endorsements.