# PLITE market-data and liquidity readiness

Official Base token: `0xb15A460142c77b42cDF57815b0eeFEb24b593196`

PumpLite V2 market: `0xa522A4Ef81fD31daec390ab46A32D4886e1461C7`

Factory: `0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4`

## What the website reports

PumpLite reads the token and its V2 bonding-curve market directly from Base. The website may show the real curve price, the market's real ETH reserve, current token supply, cumulative curve volume and completed Trade events.

The V2 market's ETH reserve is real on-chain backing for its buy/sell curve. It is **not the same thing as liquidity in an external DEX LP pool**. Outside wallets and trackers may therefore show no external liquidity until they index the PumpLite curve or PLITE has a separately indexed DEX market.

No price, volume, holder count, trade or market cap is fabricated by PumpLite.

## Public identity files

- Website: https://frymastercheese.github.io/pumplite/
- 48x48 SVG icon: https://frymastercheese.github.io/pumplite/assets/plite-icon-48.svg
- 200x200 transparent PNG: https://frymastercheese.github.io/pumplite/assets/plite-logo-200.png
- Public metadata record: https://frymastercheese.github.io/pumplite/assets/plite-info.json
- BaseScan: https://basescan.org/token/0xb15A460142c77b42cDF57815b0eeFEb24b593196
- Blockscout: https://base.blockscout.com/token/0xb15A460142c77b42cDF57815b0eeFEb24b593196
- CoinStats: https://coinstats.app/coins/0xb15A460142c77b42cDF57815b0eeFEb24b593196_base/

## External DEX liquidity

Creating PLITE/WETH liquidity is intentionally **not automated by this repository update**. It spends real assets and requires an explicit wallet approval.

Before creating a pool, read PLITE's live PumpLite curve price and initialize the DEX pool at the same economic ratio. A deliberately mismatched starting price exposes the pool to immediate arbitrage.

If the desired WETH side of a two-sided position is `E` ETH and the live curve price is `P` ETH per PLITE, the matching token amount is approximately:

`PLITE amount = E / P`

Very small pools can be technically valid but have extreme slippage. Do not manufacture volume, holders or trades to make tracker numbers appear larger.

## Remaining external actions

1. Submit/update PLITE token identity on Blockscout using the official website and public icon above.
2. Keep BaseScan/Blockscout/source links consistent.
3. After a real external DEX pool exists and is indexed, submit or refresh PLITE with market-data providers used by wallets/trackers.
4. CoinMarketCap remains optional and should only be resumed when its required social/contact fields can be filled truthfully.
