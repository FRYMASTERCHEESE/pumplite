# PLITE external token verification

Status date: 2 October 2026.

This document separates PumpLite-controlled verification evidence from independent third-party approval.

## Official PLITE identity

- Network: Base Mainnet
- Chain ID: 8453
- Token: `0xb15A460142c77b42cDF57815b0eeFEb24b593196`
- PumpLite V2 market: `0xa522A4Ef81fD31daec390ab46A32D4886e1461C7`
- Active PumpLite V2 factory: `0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4`
- First 50 holder claim: `0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2`
- Uniswap V2 PLITE/WETH pair: `0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086`
- Canonical Base WETH: `0x4200000000000000000000000000000000000006`
- Website: `https://frymastercheese.github.io/pumplite/`
- Repository: `https://github.com/FRYMASTERCHEESE/pumplite`
- PumpLite review EAS UID: `0x805a4b6019e15479a489751c44d7b078eaad6ccd71b6fe27d1ad93a234ce59b9`

## Public website verification evidence

PumpLite publishes a human-readable verification page at `/verification.html` and a machine-readable verification manifest at `/assets/token-verification.json`.

These records intentionally use the same token, market, factory, claim, DEX pair, website, repository, logo, metadata URI and EAS review identity as the canonical repository records.

A PumpLite verification label means identity/provenance review only. It does not claim that an unrelated third party has independently approved PLITE.

## Sourcify

Sourcify API v2 is the current API. Standard JSON verification is the preferred source-verification input. PumpLite retains a deterministic Base V2 standard JSON compiler input and compiler settings.

Sourcify source verification may be automated through its API, but the resulting provider status must be read from Sourcify itself rather than manufactured in the PumpLite registry.

Official documentation:
`https://docs.sourcify.dev/docs/api/`

## Blockscout

Blockscout supports smart-contract source verification, including standard JSON and Sourcify-backed verification.

Blockscout contract-ownership verification is a separate account workflow and can require the deployed-contract owner/deployer to sign a message. PumpLite automation must not forge or bypass that ownership proof.

Official documentation:
`https://docs.blockscout.com/devs/verification`
`https://docs.blockscout.com/using-blockscout/my-account/verified-addresses`

## BaseScan / Etherscan

BaseScan source-code verification and public token/profile/name-tag information are independent explorer processes. PumpLite may prepare reproducible compiler evidence and consistent identity data, but it must not claim a BaseScan badge or profile approval unless BaseScan actually reports it.

The Etherscan API V2 model supports multiple chains through the `chainid` parameter, including Base.

Official documentation:
`https://docs.etherscan.io/`

## CoinMarketCap

CoinMarketCap states that its online submission form is the official request route for listings/updates. DEXScan can discover many assets automatically from on-chain data, while a CoinMarketCap Verified Listing is manually reviewed on a best-efforts basis.

Meeting technical checks does not guarantee a tracked or verified listing. PumpLite must not manufacture trading volume, holders, liquidity, engagement or exchange activity to influence a listing decision.

Official listing criteria:
`https://support.coinmarketcap.com/hc/en-us/articles/360043659351-Listings-Criteria`

## Verification automation boundary

Repository automation may:

- reproduce compiler inputs and hashes;
- compare canonical token/project identities;
- publish official website evidence;
- query public provider status;
- prepare source-verification submissions where the provider supports automation;
- detect conflicting addresses, metadata, links or review records;
- fail closed when identity evidence drifts.

Repository automation must not:

- forge an explorer/listing badge;
- bypass deployer/owner wallet-signature requirements;
- pretend a pending provider review is approved;
- submit wallet signatures without explicit human wallet approval;
- manufacture holders, trades, liquidity, volume or engagement;
- claim a third-party security audit that has not occurred.