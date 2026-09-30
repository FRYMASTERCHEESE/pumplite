import { formatUnits } from './math.js';

const NS = 'http://www.w3.org/2000/svg';

function node(name, attrs = {}) {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

function priceNumber(value) {
  return Number(formatUnits(value, 18, 18));
}

function priceLabel(value) {
  if (!Number.isFinite(value) || value <= 0) return '-';
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
  if (value >= 0.000001) return value.toPrecision(7);
  return value.toExponential(5);
}

function timeLabel(point) {
  if (Number.isFinite(point.timestamp) && point.timestamp > 0) {
    return new Date(point.timestamp * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  return 'Block ' + Number(point.blockNumber).toLocaleString();
}

export function renderPriceChart(container, trades, symbol = 'TOKEN') {
  container.replaceChildren();

  if (!Array.isArray(trades) || trades.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'price-chart-empty';
    empty.textContent = 'No real on-chain trades in this range yet.';
    container.append(empty);
    return { count: 0, changePct: null, latestPrice: null };
  }

  const points = trades
    .map((trade, index) => ({
      index,
      price: priceNumber(trade.price),
      side: trade.isBuy ? 'buy' : 'sell',
      blockNumber: Number(trade.blockNumber),
      timestamp: Number(trade.timestamp || 0),
      transactionHash: trade.transactionHash
    }))
    .filter(point => Number.isFinite(point.price) && point.price > 0);

  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'price-chart-empty';
    empty.textContent = 'Trade events were found, but no valid execution prices could be displayed.';
    container.append(empty);
    return { count: 0, changePct: null, latestPrice: null };
  }

  const width = 760;
  const height = 300;
  const padLeft = 18;
  const padRight = 18;
  const padTop = 24;
  const padBottom = 34;
  const values = points.map(point => point.price);
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) {
    const pad = Math.max(min * 0.02, Number.EPSILON);
    min = Math.max(0, min - pad);
    max += pad;
  }

  const first = points[0].price;
  const latest = points[points.length - 1].price;
  const changePct = first > 0 ? (latest - first) / first * 100 : 0;
  const direction = changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat';

  const x = index =>
    points.length === 1
      ? width / 2
      : padLeft +
        index * (width - padLeft - padRight) /
        (points.length - 1);

  const y = value =>
    height -
    padBottom -
    (value - min) *
      (height - padTop - padBottom) /
      (max - min);

  const svg = node('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true'
  });

  for (const fraction of [0.25, 0.5, 0.75]) {
    const gy =
      padTop +
      (height - padTop - padBottom) * fraction;

    svg.append(node('line', {
      x1: padLeft,
      x2: width - padRight,
      y1: gy,
      y2: gy,
      class: 'grid'
    }));
  }

  if (points.length === 1) {
    const dot = node('circle', {
      cx: x(0),
      cy: y(points[0].price),
      r: 5,
      class: 'trend-dot trend-' + direction
    });

    const title = node('title');
    title.textContent =
      priceLabel(points[0].price) +
      ' ETH/' +
      symbol +
      ' - ' +
      timeLabel(points[0]);
    dot.append(title);
    svg.append(dot);
  } else {
    const coords = points.map((point, index) =>
      [x(index), y(point.price)]
    );

    const linePath =
      'M ' +
      coords.map(([px, py]) => px + ' ' + py).join(' L ');

    const areaPath =
      linePath +
      ' L ' +
      coords[coords.length - 1][0] +
      ' ' +
      (height - padBottom) +
      ' L ' +
      coords[0][0] +
      ' ' +
      (height - padBottom) +
      ' Z';

    svg.append(node('path', {
      d: areaPath,
      class: 'trend-area trend-area-' + direction
    }));

    svg.append(node('path', {
      d: linePath,
      class: 'trend-line trend-' + direction
    }));

    points.forEach((point, index) => {
      const dot = node('circle', {
        cx: x(index),
        cy: y(point.price),
        r: index === points.length - 1 ? 4.8 : 2.5,
        class:
          'trade-point ' +
          (point.side === 'buy' ? 'point-buy' : 'point-sell')
      });

      const title = node('title');
      title.textContent =
        (point.side === 'buy' ? 'Buy - ' : 'Sell - ') +
        priceLabel(point.price) +
        ' ETH/' +
        symbol +
        ' - ' +
        timeLabel(point);
      dot.append(title);
      svg.append(dot);
    });
  }

  const highLabel = node('text', {
    x: padLeft,
    y: 16,
    class: 'axis-label'
  });
  highLabel.textContent =
    'High ' + priceLabel(Math.max(...values));
  svg.append(highLabel);

  const lowLabel = node('text', {
    x: padLeft,
    y: height - 7,
    class: 'axis-label'
  });
  lowLabel.textContent =
    points.length > 1
      ? timeLabel(points[0])
      : 'Execution price';
  svg.append(lowLabel);

  if (points.length > 1) {
    const endLabel = node('text', {
      x: width - padRight,
      y: height - 7,
      class: 'axis-label axis-label-end'
    });
    endLabel.textContent =
      timeLabel(points[points.length - 1]);
    svg.append(endLabel);
  }

  container.append(svg);

  return {
    count: points.length,
    changePct,
    latestPrice: latest,
    highPrice: Math.max(...values),
    lowPrice: Math.min(...values),
    direction,
    firstBlock: points[0].blockNumber,
    lastBlock: points[points.length - 1].blockNumber,
    firstTimestamp: points[0].timestamp || null,
    lastTimestamp: points[points.length - 1].timestamp || null
  };
}
