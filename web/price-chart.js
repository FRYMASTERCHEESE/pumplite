import { formatUnits } from './math.js';

const NS = 'http://www.w3.org/2000/svg';

function node(name, attrs = {}) {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

export function renderPriceChart(container, trades, symbol = 'TOKEN') {
  container.replaceChildren();

  if (!Array.isArray(trades) || trades.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'price-chart-empty';
    empty.textContent = 'No on-chain trades yet. The chart will appear after the first completed buy or sell.';
    container.append(empty);
    return { count: 0, changePct: null, latestPrice: null };
  }

  const points = trades
    .map((trade, index) => ({
      index,
      price: Number(formatUnits(trade.price, 18, 18)),
      side: trade.isBuy ? 'buy' : 'sell',
      blockNumber: trade.blockNumber
    }))
    .filter(point => Number.isFinite(point.price) && point.price > 0);

  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'price-chart-empty';
    empty.textContent = 'Recent trades could not be converted into display prices.';
    container.append(empty);
    return { count: 0, changePct: null, latestPrice: null };
  }

  const width = 720;
  const height = 250;
  const padX = 38;
  const padY = 24;
  const values = points.map(point => point.price);
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) {
    const pad = Math.max(min * 0.02, Number.EPSILON);
    min = Math.max(0, min - pad);
    max += pad;
  }

  const x = index =>
    points.length === 1
      ? width / 2
      : padX + index * (width - padX * 2) / (points.length - 1);

  const y = value =>
    height - padY -
    (value - min) * (height - padY * 2) / (max - min);

  const svg = node('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true'
  });

  for (const fraction of [0.25, 0.5, 0.75]) {
    const gy = padY + (height - padY * 2) * fraction;
    svg.append(node('line', {
      x1: padX,
      x2: width - padX,
      y1: gy,
      y2: gy,
      class: 'grid'
    }));
  }

  if (points.length === 1) {
    svg.append(node('circle', {
      cx: x(0),
      cy: y(points[0].price),
      r: 5,
      class: points[0].side === 'buy' ? 'point-buy' : 'point-sell'
    }));
  } else {
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const current = points[index];
      svg.append(node('line', {
        x1: x(index - 1),
        y1: y(previous.price),
        x2: x(index),
        y2: y(current.price),
        class: current.price >= previous.price ? 'up-line' : 'down-line'
      }));
    }

    for (let index = 0; index < points.length; index++) {
      svg.append(node('circle', {
        cx: x(index),
        cy: y(points[index].price),
        r: 3.2,
        class: points[index].side === 'buy' ? 'point-buy' : 'point-sell'
      }));
    }
  }

  const maxLabel = node('text', { x: 4, y: 16, class: 'axis-label' });
  maxLabel.textContent = max.toPrecision(4) + ' ETH/' + symbol;
  svg.append(maxLabel);

  const minLabel = node('text', { x: 4, y: height - 5, class: 'axis-label' });
  minLabel.textContent = min.toPrecision(4) + ' ETH/' + symbol;
  svg.append(minLabel);

  container.append(svg);

  const first = points[0].price;
  const latest = points[points.length - 1].price;
  const changePct = first > 0 ? (latest - first) / first * 100 : 0;

  return {
    count: points.length,
    changePct,
    latestPrice: latest,
    firstBlock: points[0].blockNumber,
    lastBlock: points[points.length - 1].blockNumber
  };
}
