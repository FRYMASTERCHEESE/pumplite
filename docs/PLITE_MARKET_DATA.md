# PLITE market data and external liquidity

Status date: 1 October 2026.

Official Base token: `0xb15A460142c77b42cDF57815b0eeFEb24b593196`

PumpLite V2 market: `0xa522A4Ef81fD31daec390ab46A32D4886e1461C7`

Active PumpLite V2 factory: `0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4`

Uniswap V2 PLITE/WETH pair: `0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086`

Canonical Base WETH: `0x4200000000000000000000000000000000000006`

## PumpLite curve data

PumpLite reads PLITE and its V2 bonding-curve market directly from Base. The website can show the real
curve price, real ETH backing accounted by the PumpLite market, current supply, cumulative curve volume,
bounded rolling 24-hour activity and bounded trade history.

The PumpLite curve's ETH reserve is real on-chain backing for its own buy/sell curve.

## External Uniswap V2 data

PLITE now has a separate Uniswap V2 PLITE/WETH pair at `0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086`.

The PLITE market page reads that verified pair directly from Base and displays the current WETH reserve,
PLITE reserve, reserve-ratio DEX spot price, spot-implied ETH-equivalent pool liquidity and the Base block
used for the observation.

This external pool is not part of PumpLite curve backing. DEX reserves, swaps, fees and price can change
independently and are not included in PumpLite curve volume or backing.

The initial liquidity position was created through a separate user-approved wallet transaction. The repository
must not automate new liquidity spending without a separate explicit wallet approval.

Very small pools can have extreme price impact. A displayed reserve-ratio spot price is not a guarantee that
an order of meaningful size can execute at that price.

## Public identity files

- Website: https://frymastercheese.github.io/pumplite/
- 48x48 SVG icon: https://frymastercheese.github.io/pumplite/assets/plite-icon-48.svg
- 200x200 transparent PNG: https://frymastercheese.github.io/pumplite/assets/plite-logo-200.png
- Public metadata record: https://frymastercheese.github.io/pumplite/assets/plite-info.json
- BaseScan token page: https://basescan.org/token/0xb15A460142c77b42cDF57815b0eeFEb24b593196
- BaseScan LP contract: https://basescan.org/address/0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086
- Blockscout token page: https://base.blockscout.com/token/0xb15A460142c77b42cDF57815b0eeFEb24b593196

## Tracker/indexing boundary

Creating a valid pool does not force Phantom, BaseScan or another market-data provider to show a token price.
Those providers use their own indexing and liquidity/data-quality rules. Do not manufacture volume, holders or
trades to influence indexing.

BaseScan token-profile review and third-party wallet/tracker indexing are external processes. Keep the official
website, token address, market address, pair address and public logo consistent when submitting updates.
