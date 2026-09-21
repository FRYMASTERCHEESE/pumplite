import { parseUnits, formatUnits, quote, minimumOutput, validateMetadata } from './math.js';
const $ = id => document.getElementById(id);
const state = { config: null, chain: 'solana', adapter: null, wallet: null, market: null, quote: null, busy: false, epoch: 0, next: null };
function status(message, href) {
  $('status-text').textContent = message;
  $('status-link').hidden = !href;
  if (href) { $('status-link').href = href; state.lastTxLink = href; }
  else $('status-link').removeAttribute('href');
}
function ready() {
  const c = state.config?.[state.chain];
  return Boolean(c && (state.chain === 'solana' ? c.programId : c.factory));
}
function writable() { return ready() && state.config.transactionsEnabled && state.wallet && !state.busy; }
function controls() {
  $('chain').disabled = state.busy; $('connect').disabled = state.busy;
  $('create').disabled = !writable(); $('trade').disabled = !writable() || !state.quote;
  $('get-quote').disabled = !ready() || !state.market || state.busy;
  $('refresh').disabled = !ready() || state.busy; $('refresh-market').disabled = !ready() || state.busy;
  $('more').disabled = state.busy;
  for (const id of ['name','symbol','uri','side','amount','slippage','market-address']) $(id).disabled = state.busy;
}
function invalidateQuote() {
  state.quote = null;
  for (const id of ['quote-output','quote-min','quote-fee']) $(id).textContent = '—';
  $('quote-age').textContent = 'Get a current quote before signing.';
  controls();
}
async function getAdapter() {
  if (state.adapter) return state.adapter;
  const chain = state.chain, epoch = state.epoch;
  const module = chain === 'solana' ? await import('./adapters/solana.js') : await import('./adapters/base.js');
  if (epoch !== state.epoch) throw Error('Network selection changed');
  state.adapter = module.adapter(state.config[chain], status);
  return state.adapter;
}
async function action(fn) {
  if (state.busy) return;
  state.busy = true; state.lastTxLink = null; controls();
  try { await fn(); } catch (error) { status((error.shortMessage || error.message || 'Operation could not complete') + (state.lastTxLink ? ' Inspect the linked transaction before retrying.' : ''), state.lastTxLink); }
  finally { state.busy = false; controls(); if (state.pendingRoute) { state.pendingRoute = false; queueMicrotask(() => action(route)); } }
}
function requireDeployment() { if (!ready()) throw Error('No reviewed deployment configured for ' + state.config[state.chain].name); }
function requireWrite() {
  requireDeployment();
  if (!state.config.transactionsEnabled) throw Error('Transactions are disabled in this local build');
  if (!state.wallet) throw Error('Connect a wallet first');
}
function row(m) {
  const link = document.createElement('a'); link.className = 'market-row';
  link.href = '#' + state.chain + '/' + encodeURIComponent(m.id);
  const title = document.createElement('b'); title.textContent = m.name + ' · ' + m.symbol;
  const detail = document.createElement('small');
  detail.textContent = formatUnits(m.nativeReserve, m.nativeDecimals) + ' ' + m.unit + ' reserve · ' + m.source;
  link.append(title, detail); return link;
}
async function discover(append = false) {
  requireDeployment();
  const result = await (await getAdapter()).list(append ? state.next : 0);
  if (!append) $('markets').replaceChildren();
  for (const market of result.markets) $('markets').append(row(market));
  if (!result.markets.length && !append) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No markets found on chain.';
    $('markets').append(empty);
  }
  state.next = result.next; $('more').hidden = result.next === null;
  status('Read ' + result.markets.length + ' markets from ' + state.config[state.chain].name + '. Refresh to update.');
}
function renderMarket(m) {
  $('market-metadata').textContent = m.uri ? 'Creator metadata URI (not fetched or verified): ' + m.uri : 'No creator metadata URI supplied.';
  $('market-name').textContent = m.name; $('market-symbol').textContent = m.symbol + ' / ' + m.unit;
  $('market-source').textContent = m.source + ' · fetched ' + new Date(m.observedAt).toLocaleTimeString() + ' · refresh on demand';
  $('native-reserve').textContent = formatUnits(m.nativeReserve, m.nativeDecimals) + ' ' + m.unit;
  $('token-reserve').textContent = formatUnits(m.tokenReserve, m.decimals, 2) + ' ' + m.symbol;
  $('volume').textContent = formatUnits(m.volume, m.nativeDecimals) + ' ' + m.unit;
  $('virtual').textContent = formatUnits(m.virtualNative, m.nativeDecimals) + ' ' + m.unit;
  const distributed = Number((m.supply - m.tokenReserve) * 10_000n / m.supply) / 100;
  $('distribution').value = distributed;
  $('distribution-label').textContent = distributed.toFixed(2) + '% distributed from the original 1 billion token inventory.';
  const c = state.config[state.chain];
  $('market-link').href = c.explorer + (state.chain === 'solana' ? '/account/' : '/address/') + m.id;
  $('token-link').href = c.explorer + '/token/' + m.token;
  $('amount-label').textContent = $('side').value === 'buy' ? 'Amount (' + m.unit + ')' : 'Amount (' + m.symbol + ')';
}
async function loadMarket(id) {
  requireDeployment(); invalidateQuote();
  state.market = null;
  $('balance').textContent = 'Connect a wallet to read balances.';
  const m = await (await getAdapter()).market(id);
  state.market = m; renderMarket(m);
  if (state.wallet) {
    const balances = await state.adapter.balances(m);
    $('balance').textContent = 'Wallet: ' + formatUnits(balances.native, m.nativeDecimals) + ' ' + m.unit +
      ' · ' + formatUnits(balances.tokens, m.decimals) + ' ' + m.symbol + ' (network costs additional)';
  }
}
async function route() {
  state.market = null; invalidateQuote();
  const parts = location.hash.slice(1).split('/');
  if (parts[0] && !['solana','base'].includes(parts[0])) throw Error('Unknown network in market link');
  if (parts[0] && state.chain !== parts[0]) switchChain(parts[0]);
  const id = parts[1] ? decodeURIComponent(parts[1]) : null;
  $('home').hidden = Boolean(id); $('market-page').hidden = !id;
  if (id) {
    $('market-name').textContent = 'Loading market…';
    for (const field of ['market-source','market-metadata','native-reserve','token-reserve','volume','virtual','distribution-label']) $(field).textContent = '—';
    $('distribution').value = 0;
    $('market-link').removeAttribute('href'); $('token-link').removeAttribute('href');
    await loadMarket(id);
  }
}
function switchChain(chain) {
  state.chain = chain; state.epoch++; state.adapter = null; state.wallet = null; state.market = null; state.next = null;
  $('chain').value = chain; $('connect').textContent = 'Connect wallet';
  $('deployment').textContent = ready() ?
    (state.config.transactionsEnabled ? state.config[chain].name + ' · wallet approval spends real funds.' : 'Reviewed address configured; transactions remain disabled.') :
    state.config[chain].name + ' · no deployment configured. Token creation and trading are disabled.';
  $('markets').replaceChildren();
  const empty = document.createElement('p'); empty.className = 'empty';
  empty.textContent = ready() ? 'Press Refresh to read markets from the chain.' : 'No verified deployment configured. No market data is displayed.';
  $('markets').append(empty); $('more').hidden = true; invalidateQuote();
  status(state.config[chain].name + ' selected. Wallet disconnected.');
}
$('chain').addEventListener('change', () => { switchChain($('chain').value); location.hash = ''; $('home').hidden = false; $('market-page').hidden = true; });
$('connect').addEventListener('click', () => action(async () => {
  state.wallet = await (await getAdapter()).connect();
  $('connect').textContent = state.wallet.slice(0, 5) + '…' + state.wallet.slice(-4);
  status('Wallet connected: ' + state.wallet);
  if (state.market) await loadMarket(state.market.id);
}));
$('refresh').addEventListener('click', () => action(() => discover()));
$('more').addEventListener('click', () => action(() => discover(true)));
$('refresh-market').addEventListener('click', () => action(() => loadMarket(state.market?.id || decodeURIComponent(location.hash.split('/')[1]))));
$('open-form').addEventListener('submit', e => { e.preventDefault(); if (!state.busy) location.hash = state.chain + '/' + encodeURIComponent($('market-address').value.trim()); });
$('create-form').addEventListener('submit', e => { e.preventDefault(); action(async () => {
  requireWrite();
  const data = { name: $('name').value.trim(), symbol: $('symbol').value.trim(), uri: $('uri').value.trim() };
  validateMetadata(data.name, data.symbol, data.uri);
  const id = await (await getAdapter()).create(data);
  location.hash = state.chain + '/' + encodeURIComponent(id);
}); });
for (const id of ['side','amount','slippage']) $(id).addEventListener('input', () => { invalidateQuote(); if (state.market) renderMarket(state.market); });
$('get-quote').addEventListener('click', () => action(async () => {
  requireDeployment(); invalidateQuote();
  const m = await (await getAdapter()).market(state.market.id); state.market = m; renderMarket(m);
  const side = $('side').value, text = $('amount').value.trim();
  const amount = parseUnits(text, side === 'buy' ? m.nativeDecimals : m.decimals);
  if (state.chain === 'solana' && amount > 18_446_744_073_709_551_615n) throw Error('Amount exceeds Solana integer range');
  const slippage = Number($('slippage').value) * 100;
  const slippageBps = Math.round(slippage);
  if (Math.abs(slippage - slippageBps) > 1e-7) throw Error('Slippage supports two decimal places');
  const q = quote(m, side, amount), min = minimumOutput(q.output, slippageBps);
  const decimals = side === 'buy' ? m.decimals : m.nativeDecimals, unit = side === 'buy' ? m.symbol : m.unit;
  state.quote = { ...q, min, amount, side, at: Date.now(), market: m.id, chain: state.chain };
  $('quote-output').textContent = formatUnits(q.output, decimals, decimals) + ' ' + unit;
  $('quote-min').textContent = formatUnits(min, decimals, decimals) + ' ' + unit;
  $('quote-fee').textContent = formatUnits(q.fee, m.nativeDecimals, m.nativeDecimals) + ' ' + m.unit;
  $('quote-age').textContent = 'Quoted at ' + new Date().toLocaleTimeString() + '. Valid for review for 30 seconds; chain slippage protection still applies.';
}));
$('trade-form').addEventListener('submit', e => { e.preventDefault(); action(async () => {
  requireWrite();
  const q = state.quote;
  if (!q || Date.now() - q.at > 30_000 || q.market !== state.market?.id || q.chain !== state.chain) {
    invalidateQuote(); throw Error('Quote expired. Request a fresh quote.');
  }
  invalidateQuote();
  await (await getAdapter()).trade(state.market, q.side, q.amount, q.min);
  await loadMarket(state.market.id);
}); });
window.addEventListener('hashchange', () => {
  // Route after an in-flight operation settles; never change transaction context mid-signature.
  if (!state.busy) action(route); else state.pendingRoute = true;
});
function walletChanged() {
  state.wallet = null; $('connect').textContent = 'Connect wallet'; invalidateQuote();
  $('balance').textContent = 'Wallet changed. Reconnect to read balances.';
}
window.ethereum?.on?.('accountsChanged', walletChanged);
window.ethereum?.on?.('chainChanged', walletChanged);
window.solana?.on?.('accountChanged', walletChanged);
window.solana?.on?.('disconnect', walletChanged);
try {
  const response = await fetch('./config.json', { cache: 'no-store' });
  if (!response.ok) throw Error('Unable to load public network configuration');
  state.config = await response.json();
  if (state.config.schemaVersion !== 1 || state.config.feeBps !== 25 || state.config.base.chainId !== 8453) throw Error('Unsupported configuration');
  switchChain('solana'); await action(route);
} catch (error) { status(error.message); controls(); }
