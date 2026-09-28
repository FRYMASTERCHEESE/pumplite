import { metadataExtras, LINK_FIELDS } from './metadata-fields.js';
import { tokenTrust } from './verification.js';
import { loadReviewedRegistry, badges, verificationPanel } from './verification-ui.js';
import { discoverEvm, solanaDiagnostics } from './wallets.js';
import { mobileBrowseLink } from './mobile.js';
import { metadataDocument } from './metadata.js';
import { parseUnits, formatUnits, quote, minimumOutput, validateMetadata } from './math.js';
import { validatePublicConfig, deploymentConfigured, transactionConfigEnabled } from './release-config.js';
if (window.top !== window.self) {
  document.body.replaceChildren(document.createTextNode('Open PumpLite directly in your browser. Embedded wallet interactions are disabled.'));
  throw Error('Embedded PumpLite is disabled');
}
const $ = id => document.getElementById(id);
$('skip-content').addEventListener('click', event => { event.preventDefault(); $('main-content').focus(); });
const state = { config: null, chain: 'base', adapter: null, wallet: null, market: null, quote: null, busy: false, epoch: 0, next: null, markets: [], registry: null };
function status(message, href) {
  $('status-text').textContent = message;
  $('status-link').hidden = !href;
  if (href) { $('status-link').href = href; state.lastTxLink = href; }
  else $('status-link').removeAttribute('href');
}
function ready() {
  return deploymentConfigured(state.config, state.chain);
}
function writable() {
  return transactionConfigEnabled(state.config, state.chain) &&
    state.wallet &&
    !state.busy;
}
let phantomPrepared = false;
function diagnostic(message = '') {
  $('wallet-diagnostic').textContent = solanaDiagnostics(window) + (message ? ' | ' + message : '');
}
function controls() {
  $('phantom-diagnostics').hidden = state.chain !== 'solana';
  $('wallet-diagnostic').hidden = state.chain !== 'solana';
  if (state.chain === 'solana' && !state.wallet) $('connect').textContent = state.busy ? 'Preparing / waiting…' : phantomPrepared ? 'Approve in Phantom' : 'Connect wallet';
  const mobileLink = mobileBrowseLink(state.chain, location.href);
  $('mobile-open').hidden = !mobileLink || state.busy;
  if (mobileLink) { $('mobile-open').href = mobileLink; $('mobile-open').textContent = 'Open in ' + (state.chain === 'solana' ? 'Phantom' : 'MetaMask'); }
  const cbLink = state.chain === 'base' ? mobileBrowseLink('base', location.href, 'coinbase') : null;
  $('mobile-coinbase').hidden = !cbLink || state.busy;
  if (cbLink) $('mobile-coinbase').href = cbLink;
  $('wallet-choice-label').hidden = state.chain !== 'base';
  $('wallet-choice').disabled = state.busy || Boolean(state.wallet);
  $('download-metadata').disabled = state.busy;
  const metadataEnabled = state.config?.metadataUploads?.enabled === true;
  $('metadata-image').disabled = state.busy || !metadataEnabled;
  $('publish-metadata').disabled = state.busy || !metadataEnabled || !state.wallet || !$('metadata-image').files?.length;
  $('metadata-upload-help').textContent =
    !metadataEnabled ? 'Metadata publishing is currently disabled.' :
    !state.wallet ? 'Connect a wallet to authorize IPFS publishing. No private key is requested.' :
    !$('metadata-image').files?.length ? 'Choose a PNG, JPEG or WebP token image.' :
    'Ready to publish. Authorization signatures do not spend SOL or ETH.';
  $('chain').disabled = state.busy; $('connect').disabled = state.busy;
  $('create').disabled = !writable(); $('trade').disabled = !writable() || !state.quote;
  $('get-quote').disabled = !ready() || !state.market || state.busy;
  $('refresh').disabled = !ready() || state.busy; $('refresh-market').disabled = !ready() || state.busy;
  $('more').disabled = state.busy; $('verified-only').disabled = state.busy;
  $('show-create').disabled=state.busy; $('show-explore').disabled=state.busy;
  for (const id of ['description','image-uri','banner-uri','website','twitter','telegram','discord','name','symbol','uri','side','amount','slippage','market-address']) $(id).disabled = state.busy;
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
  if (chain === 'solana') { diagnostic('Loading Solana SDK…'); status('Loading Solana wallet support…'); }
  const module = chain === 'solana' ? await import('./adapters/solana.js') : await import('./adapters/base.js');
  if (epoch !== state.epoch) throw Error('Network selection changed');
  state.adapter = module.adapter(state.config[chain], (message, href) => { if (chain === 'solana') diagnostic(message); status(message, href); }, walletChanged);
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
  if (!transactionConfigEnabled(state.config, state.chain)) {
    throw Error('Transactions are disabled for ' + state.config[state.chain].name);
  }
  if (!state.wallet) throw Error('Connect a wallet first');
}
function row(m) {
  const link = document.createElement('a'); link.className = 'market-row';
  link.href = '#' + state.chain + '/' + encodeURIComponent(m.id);
  const title = document.createElement('b'); title.textContent = m.name + ' · ' + m.symbol;
  const detail = document.createElement('small');
  detail.textContent = formatUnits(m.nativeReserve, m.nativeDecimals) + ' ' + m.unit + ' reserve · ' + m.source;
  link.append(title, badges(state.chain,state.config?.[state.chain],m,state.registry), detail); return link;
}
async function refreshRegistry() {
  state.registry=null;
  try { state.registry=await loadReviewedRegistry(); $('verification-list-status').textContent='Verified is an owner identity/provenance review, not a safety or investment endorsement.'; }
  catch { $('verification-list-status').textContent='Reviewed list unavailable. Verified badges are hidden; factory provenance is separate.'; }
}
function renderDiscovery() {
  $('markets').replaceChildren();
  const visible=state.markets.filter(m=>!$('verified-only').checked || tokenTrust(state.chain,state.config[state.chain],m,state.registry).verified);
  for(const m of visible)$('markets').append(row(m));
  if(!visible.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=$('verified-only').checked?'No verified markets in the loaded results. Load more or refresh to check additional markets.':'No markets loaded. Refresh to read the chain.';$('markets').append(empty);}
}
async function discover(append = false) {
  requireDeployment();
  if(!append)state.markets=[];
  // Remove old labels before any fresh read; failures cannot leave a stale Verified badge.
  state.registry=null; renderDiscovery();
  const result = await (await getAdapter()).list(append ? state.next : 0);
  await refreshRegistry();
  state.markets=append?[...state.markets,...result.markets]:result.markets;
  renderDiscovery();
  state.next = result.next; $('more').hidden = result.next === null;
  status('Read ' + result.markets.length + ' markets from ' + state.config[state.chain].name + '. Filters apply to loaded results.');
}
function renderMarket(m) {
  verificationPanel(state.chain,state.config[state.chain],m,state.registry);
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
  $('market-badges').replaceChildren(); $('verification-details').replaceChildren();
  $('verification-state').textContent='Checking live factory provenance and the owner review list…';
  $('balance').textContent = 'Connect a wallet to read balances.';
  const m = await (await getAdapter()).market(id);
  await refreshRegistry();
  state.market = m; renderMarket(m);
  if (state.wallet) {
    const balances = await state.adapter.balances(m);
    $('balance').textContent = 'Wallet: ' + formatUnits(balances.native, m.nativeDecimals) + ' ' + m.unit +
      ' · ' + formatUnits(balances.tokens, m.decimals) + ' ' + m.symbol + ' (network costs additional)';
  }
}
async function route() {
  state.market = null; invalidateQuote();
  $('market-badges').replaceChildren(); $('verification-details').replaceChildren();
  $('verification-state').textContent='Identity has not been checked.';
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
  state.adapter?.disconnect();
  state.chain = chain; state.epoch++; state.adapter = null; state.wallet = null; state.market = null; state.next = null; state.markets=[]; state.registry=null;
  $('create-network').textContent=chain==='base'?'Base Mainnet · ETH pair':'Solana Mainnet · deployment pending';
  $('create-pair').textContent=chain==='base'?'Base ETH':'Solana locked';
  $('chain').value = chain; $('connect').textContent = 'Connect wallet';
  const configured = ready();
  const writes = transactionConfigEnabled(state.config, chain);
  $('deployment').textContent = configured ?
    (writes ?
      state.config[chain].name + ' · live configuration. Wallet approval spends real funds.' :
      state.config[chain].name + ' · deployment configured; transactions remain disabled.') :
    (chain === 'solana' ?
      state.config[chain].name + ' · no deployment configured (coming soon / deployment pending). Token creation and trading are disabled.' :
      state.config[chain].name + ' · no deployment configured (available after deployment). Token creation and trading are disabled.');
  $('markets').replaceChildren();
  const empty = document.createElement('p'); empty.className = 'empty';
  empty.textContent = ready() ? 'Press Refresh to read markets from the chain.' : 'No verified deployment configured. No market data is displayed.';
  $('markets').append(empty); $('more').hidden = true; invalidateQuote();
  status(state.config[chain].name + ' selected. Wallet disconnected.');
}
$('chain').addEventListener('change', () => { switchChain($('chain').value); location.hash = ''; $('home').hidden = false; $('market-page').hidden = true; });
$('connect').addEventListener('click', () => action(async () => {
  if (state.wallet) { state.adapter?.disconnect(); status('Wallet disconnected from this site.'); return; }
  if (state.chain === 'solana') {
    diagnostic('Connect tapped');
    if (!phantomPrepared) {
      try { await (await getAdapter()).prepareConnect(); phantomPrepared = true; }
      catch (error) { diagnostic(error.message); throw error; }
      return;
    }
    phantomPrepared = false;
    try { state.wallet = await state.adapter.connect(true); }
    catch (error) { diagnostic(error.message); throw error; }
  } else {
  wallets.refresh();
  const selected = wallets.entries[Number($('wallet-choice').value)]?.provider;
  state.wallet = await (await getAdapter()).connect(selected);
  }
  $('connect').textContent = 'Disconnect ' + state.wallet.slice(0, 5) + '…' + state.wallet.slice(-4);
  status('Wallet connected: ' + state.wallet);
  if (state.chain === 'solana') {
    const solanaWrites = transactionConfigEnabled(state.config, 'solana');
    diagnostic(solanaWrites ?
      'Wallet connected. Checking Mainnet RPC.' :
      'Wallet connected. Checking Mainnet RPC; Solana transactions remain disabled.');
    try {
      await state.adapter.verifyNetwork();
      diagnostic(solanaWrites ?
        'Wallet connected. Mainnet RPC verified.' :
        'Wallet connected. Mainnet RPC verified. Solana transactions remain disabled.');
    }
    catch (error) { diagnostic('Wallet connected for account access only. Mainnet RPC NOT verified: ' + error.message + '. On-chain operations remain blocked until verification succeeds.'); }
  }
  if (state.market) await loadMarket(state.market.id);
}));
$('download-metadata').addEventListener('click', () => action(async () => {
  const text = metadataDocument($('name').value.trim(), $('symbol').value.trim(), $('description').value, $('image-uri').value.trim(), projectLinks(), $('banner-uri').value.trim());
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'token-metadata.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Metadata JSON downloaded locally. Publish it to persistent storage before creating the token.');
}));
let mediaSequence=0, publishedDraft=null;
function projectLinks(){return Object.fromEntries(LINK_FIELDS.map(key=>[key,$(key).value.trim()]));}
function draftIdentity(){return JSON.stringify([$ ('name').value,$('symbol').value,$('description').value,projectLinks(),$('banner-uri').value,$('metadata-image').files?.[0]?.name]);}
function invalidatePublished(){if(publishedDraft && publishedDraft!==draftIdentity()){$('uri').value='';publishedDraft=null;status('Token details changed. Publish fresh metadata or enter a matching URI before creation.');}}
for(const id of ['name','symbol','description','banner-uri',...LINK_FIELDS])$(id).addEventListener('input',invalidatePublished);
$('uri').addEventListener('input',()=>{publishedDraft=null;});
$('metadata-image').addEventListener('change', async () => {
  const sequence=++mediaSequence; controls();
  if(publishedDraft){$('uri').value='';publishedDraft=null;}
  $('image-preview').hidden=true; $('image-preview').removeAttribute('src');
  const file=$('metadata-image').files?.[0];
  if(!file){$('media-status').textContent='No image selected.';return;}
  $('media-status').textContent='Preparing a safe local preview…';
  try {
    const {normalizeImage}=await import('./metadata-auth-client.js');
    const png=await normalizeImage(file);
    const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Preview could not be read'));r.readAsDataURL(png);});
    if(sequence!==mediaSequence)return;
    $('image-preview').src=data; $('image-preview').hidden=false;
    $('media-status').textContent='Local preview ready · '+Math.ceil(png.size/1024)+' KiB prepared PNG. Nothing uploaded.';
  } catch(error){if(sequence===mediaSequence){$('media-status').textContent=error.message;$('metadata-image').value='';controls();}}
});

$('publish-metadata').addEventListener('click', () => action(async () => {
  if (state.config?.metadataUploads?.enabled !== true) throw Error('Metadata uploads are not enabled');
  if (!state.wallet) throw Error('Connect a wallet first');

  const image = $('metadata-image').files?.[0];
  if (!image) throw Error('Choose a token image first');

  const adapter = await getAdapter();
  if (typeof adapter.signMetadataMessage !== 'function') throw Error('Connected wallet does not support metadata authorization');

  const { uploadTokenMetadata } = await import('./metadata-auth-client.js');

  const result = await uploadTokenMetadata({
    enabled: true,
    chain: state.chain,
    subject: state.wallet,
    signMessage: message => adapter.signMetadataMessage(message),
    image,
    name: $('name').value.trim(),
    symbol: $('symbol').value.trim(),
    description: $('description').value,
    links: projectLinks(), banner: $('banner-uri').value.trim(),
    onProgress: message => status(message)
  });

  $('image-uri').value = result.image.uri;
  $('uri').value = result.metadata.uri;
  publishedDraft=draftIdentity();

  status('Metadata published to IPFS. Metadata URI is ready.');
  controls();
}));

$('show-create').addEventListener('click',()=>{$('create-section').scrollIntoView({block:'start'});$('name').focus();});
$('show-explore').addEventListener('click',()=>{$('explore-section').scrollIntoView({block:'start'});$('explore-section').focus();});
$('verified-only').addEventListener('change',()=>action(async()=>{state.registry=null;renderDiscovery();await refreshRegistry();renderDiscovery();}));

$('refresh').addEventListener('click', () => action(() => discover()));
$('more').addEventListener('click', () => action(() => discover(true)));
$('refresh-market').addEventListener('click', () => action(() => loadMarket(state.market?.id || decodeURIComponent(location.hash.split('/')[1]))));
$('open-form').addEventListener('submit', e => { e.preventDefault(); if (!state.busy) location.hash = state.chain + '/' + encodeURIComponent($('market-address').value.trim()); });
$('create-form').addEventListener('submit', e => { e.preventDefault(); action(async () => {
  requireWrite();
  const data = { name: $('name').value.trim(), symbol: $('symbol').value.trim(), uri: $('uri').value.trim() };
  validateMetadata(data.name, data.symbol, data.uri);
  const extras=metadataExtras(projectLinks(),$('banner-uri').value.trim());
  if(!data.uri && ($('description').value || $('metadata-image').files?.length || Object.keys(extras).length || $('image-uri').value)) throw Error('Publish or pin your metadata first and enter its URI. Token details must not be silently omitted.');
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
  phantomPrepared = false;
  state.wallet = null; $('connect').textContent = 'Connect wallet'; invalidateQuote();
  $('balance').textContent = 'Wallet changed. Reconnect to read balances.';
}
const wallets = discoverEvm(window, () => queueMicrotask(renderWalletChoices));
function renderWalletChoices() {
  const previous = $('wallet-choice').value;
  $('wallet-choice').replaceChildren();
  for (const [i, entry] of wallets.entries.entries()) {
    const option = document.createElement('option'); option.value = String(i); option.textContent = entry.name;
    $('wallet-choice').append(option);
  }
  if (previous && wallets.entries[Number(previous)]) $('wallet-choice').value = previous;
}
renderWalletChoices();
window.addEventListener('focus', () => { wallets.refresh(); if (!state.busy) diagnostic('Page resumed; provider detection refreshed.'); });
diagnostic('Ready; no wallet request sent.');
try {
  const response = await fetch('./config.json', { cache: 'no-store' });
  if (!response.ok) throw Error('Unable to load public network configuration');
  state.config = validatePublicConfig(await response.json());
  switchChain('base'); await action(route);
  document.documentElement.dataset.walletAppReady = 'ready';
} catch (error) { status(error.message); controls(); }
