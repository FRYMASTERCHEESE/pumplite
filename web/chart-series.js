// Presentation-only aggregation. Callers supply confirmed execution prices.
// No gap filling, interpolation into candles, or fabricated timestamps.
export function chartPoints(trades, toPrice) {
  return (Array.isArray(trades) ? trades : []).flatMap((trade, index) => {
    let price;
    try { price = toPrice(trade.price); } catch { return []; }
    if (!Number.isFinite(price) || price <= 0) return [];
    return [{index, price, side: trade.isBuy ? 'buy' : 'sell',
      blockNumber: Number(trade.blockNumber), timestamp: Number(trade.timestamp || 0),
      transactionHash: trade.transactionHash}];
  }).sort((a, b) => {
    if (a.timestamp > 0 && b.timestamp > 0 && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (Number.isFinite(a.blockNumber) && Number.isFinite(b.blockNumber) && a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return a.index - b.index;
  });
}
export function candleSeries(points, range = 'LIVE') {
  if (!points.length || points.some(p => !Number.isSafeInteger(p.timestamp) || p.timestamp <= 0)) return [];
  const interval = ({LIVE:60,'1D':900,'1W':3600,'1M':14400,'1Y':86400,ALL:86400})[range] || 60;
  const buckets = new Map();
  for (const point of [...points].sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)) {
    const time = Math.floor(point.timestamp / interval) * interval;
    const candle = buckets.get(time);
    if (candle) {
      candle.high = Math.max(candle.high, point.price);
      candle.low = Math.min(candle.low, point.price);
      candle.close = point.price;
      candle.count++;
    } else buckets.set(time, {time, open:point.price, high:point.price, low:point.price, close:point.price, count:1});
  }
  return [...buckets.values()];
}
