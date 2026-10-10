import { formatUnits } from './math.js';
import { chartPoints, candleSeries } from './chart-series.js';

const NS = 'http://www.w3.org/2000/svg';

function node(name, attrs = {}) {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

function priceNumber(value, decimals) {
  return Number(formatUnits(value, decimals, decimals));
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

export function renderPriceChart(container, trades, symbol = 'TOKEN', nativeDecimals = 18, unit = 'ETH', options = {}) {
  container.replaceChildren();

  if (!Array.isArray(trades) || trades.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'price-chart-empty';
    empty.textContent = 'No real on-chain trades in this range yet.';
    container.append(empty);
    return { count: 0, changePct: null, latestPrice: null };
  }

  const points = chartPoints(trades, value => priceNumber(value, nativeDecimals));

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

  const hasTime = points.every(p => Number.isSafeInteger(p.timestamp) && p.timestamp > 0) && points.at(-1).timestamp > points[0].timestamp;
  const timeX = time => padLeft + (time - points[0].timestamp) * (width - padLeft - padRight) / (points.at(-1).timestamp - points[0].timestamp);
  const x = index => hasTime ? timeX(points[index].timestamp) :
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

  const candles = options.style === 'candles' ? candleSeries(points, options.range) : [];
  if (options.style === 'candles' && !candles.length) {
    const notice = document.createElement('p');
    notice.className = 'fine';
    notice.textContent = 'Candles need timestamped confirmed trades. Showing execution sequence instead.';
    container.append(notice);
  }
  if (candles.length) {
    const firstTime = candles[0].time;
    const span = candles.at(-1).time - firstTime;
    const candleX = time => span ? padLeft + 8 + (time - firstTime) * (width - padLeft - padRight - 16) / span : width / 2;
    const bodyWidth = Math.max(2, Math.min(14, (width - padLeft - padRight) / candles.length * 0.65));
    for (const candle of candles) {
      const cx = candleX(candle.time);
      const color = candle.close >= candle.open ? 'up' : 'down';
      svg.append(node('line', {x1:cx,x2:cx,y1:y(candle.high),y2:y(candle.low),class:'candle-wick trend-' + color}));
      const body = node('rect', {x:cx-bodyWidth/2,y:Math.min(y(candle.open),y(candle.close)),
        width:bodyWidth,height:Math.max(1,Math.abs(y(candle.close)-y(candle.open))),class:'candle-body candle-' + color});
      const title = node('title');
      title.textContent = timeLabel({timestamp:candle.time}) + ' · Open ' + priceLabel(candle.open) + ' · High ' + priceLabel(candle.high) + ' · Low ' + priceLabel(candle.low) + ' · Close ' + priceLabel(candle.close) + ' · ' + candle.count + ' trades';
      body.append(title);
      svg.append(body);
    }
    const coverage = document.createElement('p');
    coverage.className = 'fine';
    coverage.textContent = 'OHLC from loaded confirmed trades only. Empty intervals are not filled; incomplete history may omit trades.';
    container.append(coverage);
  } else if (points.length === 1) {
    const dot = node('circle', {
      cx: x(0),
      cy: y(points[0].price),
      r: 5,
      class: 'trend-dot trend-' + direction
    });

    const title = node('title');
    title.textContent =
      priceLabel(points[0].price) +
      ' ' + unit + '/' +
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
        ' ' + unit + '/' +
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

  const cursor = node('line', {x1:0,x2:0,y1:padTop,y2:height-padBottom,class:'chart-crosshair',visibility:'hidden'});
  svg.append(cursor);
  const inspect = document.createElement('p');
  inspect.className = 'chart-inspector';
  inspect.setAttribute('aria-live', 'polite');
  inspect.textContent = 'Touch or hover to inspect · use left/right arrow keys';
  svg.setAttribute('aria-hidden', 'false');
  svg.setAttribute('role', 'group');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', 'Execution chart. Use left and right arrow keys to inspect confirmed trades.');
  const candleSpan = candles.length ? candles.at(-1).time - candles[0].time : 0;
  const candleX = candle => candleSpan ? padLeft + 8 + (candle.time-candles[0].time) * (width-padLeft-padRight-16)/candleSpan : width/2;
  const inspectCount = candles.length || points.length;
  let selected = inspectCount - 1;
  function inspectAt(index) {
    selected = Math.max(0, Math.min(inspectCount - 1, index));
    if (candles.length) {
      const candle = candles[selected];
      cursor.setAttribute('x1',candleX(candle)); cursor.setAttribute('x2',candleX(candle)); cursor.setAttribute('visibility','visible');
      inspect.textContent = timeLabel({timestamp:candle.time}) + ' · O ' + priceLabel(candle.open) + ' H ' + priceLabel(candle.high) + ' L ' + priceLabel(candle.low) + ' C ' + priceLabel(candle.close) + ' ' + unit + ' · ' + candle.count + ' trades';
      return;
    }
    const point = points[selected];
    cursor.setAttribute('x1', x(selected)); cursor.setAttribute('x2', x(selected));
    cursor.setAttribute('visibility', 'visible');
    inspect.textContent = priceLabel(point.price) + ' ' + unit + '/' + symbol + ' · ' + timeLabel(point) + ' · ' + point.side;
  }
  // Candle inspection reports the bucket under the pointer; no invented intermediate values.
  svg.addEventListener('pointermove', event => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const px = (event.clientX - rect.left) * width / rect.width;
    if (candles.length) {
      let nearest = 0;
      for (let i=1;i<candles.length;i++) if (Math.abs(candleX(candles[i])-px)<Math.abs(candleX(candles[nearest])-px)) nearest=i;
      inspectAt(nearest);
    } else {
      let nearest = 0;
      for (let i=1;i<points.length;i++) if (Math.abs(x(i)-px)<Math.abs(x(nearest)-px)) nearest=i;
      inspectAt(nearest);
    }
  });
  svg.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    inspectAt(event.key === 'Home' ? 0 : event.key === 'End' ? inspectCount-1 : selected + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  container.append(svg, inspect);

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
