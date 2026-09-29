import { metadataExtras, LINK_FIELDS } from './metadata-fields.js';
import { tokenTrust } from './verification.js';
import { loadReviewedRegistry, badges, verificationPanel } from './verification-ui.js';
import { discoverEvm, solanaDiagnostics } from './wallets.js';
import { mobileBrowseLink } from './mobile.js';
import { metadataDocument } from './metadata.js';
import { parseUnits, formatUnits, quote, quoteBaseV2, minimumOutput, validateMetadata } from './math.js';
import { validatePublicConfig, deploymentConfigured, transactionConfigEnabled } from './release-config.js';
import { renderPriceChart } from './price-chart.js';
if (window.top !== window.self) {
  document.body.replaceChildren(document.createTextNode('Open PumpLite directly in your browser. Embedded wallet interactions are disabled.'));
  throw Error('Embedded PumpLite is disabled');
}
const $ = id => document.getElementById(id);
$('skip-content').addEventListener('click', event => { event.preventDefault(); $('main-content').focus(); });
const state = { config: null, chain: 'base', adapter: null, wallet: null, market: null, quote: null, busy: false, epoch: 0, next: null, markets: [], registry: null, reviewProof: null, reviewSchemaReady: false };
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

  const baseV2 =
    state.chain === 'base' &&
    state.config?.base?.contractVersion === 2;

  $('base-v2-create-options').hidden = !baseV2;
  $('create-supply-fact').textContent = baseV2 ? 'Custom' : '1 billion';
  $('create-supply-mode-fact').textContent = baseV2 ? 'Supply options' : 'Fixed supply';
  $('create-supply-help').textContent =
    baseV2
      ? 'No creator allocation. Choose Fixed / No Mint or a permanently capped Mintable supply.'
      : 'No creator allocation. All supply starts in the market vault. No future minting.';

  $('v2-supply-mode').disabled = state.busy || !baseV2;
  $('v2-initial-supply').disabled = state.busy || !baseV2;
  $('v2-initial-mayhem').disabled = state.busy || !baseV2;

  $('v2-max-supply').disabled =
    state.busy ||
    !baseV2 ||
    $('v2-supply-mode').value !== 'mintable';

  $('base-v2-buy-burn-submit').disabled =
    !writable() || state.market?.contractVersion !== 2;

  $('v2-mint-submit').disabled =
    !writable() ||
    state.market?.contractVersion !== 2 ||
    state.market?.mintingLocked === true ||
    state.market?.mintableAtLaunch !== true;

  $('v2-lock-minting').disabled =
    !writable() ||
    state.market?.contractVersion !== 2 ||
    state.market?.mintingLocked === true ||
    state.market?.mintableAtLaunch !== true;

  const controllerWallet =
    state.wallet &&
    state.market?.mayhemController &&
    state.wallet.toLowerCase() ===
      String(state.market.mayhemController).toLowerCase();

  const mayhemReady =
    state.market?.contractVersion === 2 &&
    mayhemManualReady(state.market);

  $('v2-mayhem-on').disabled =
    !writable() ||
    !controllerWallet ||
    !mayhemReady ||
    state.market?.mayhemActive === true;

  $('v2-mayhem-off').disabled =
    !writable() ||
    !controllerWallet ||
    !mayhemReady ||
    state.market?.mayhemActive !== true;

  $('v2-support-submit').disabled =
    !writable() || state.market?.contractVersion !== 2;

  const ownerReviewReady =
    writable() &&
    state.chain === 'base' &&
    state.market?.contractVersion === 2 &&
    state.wallet?.toLowerCase() === String(state.config?.base?.treasury || '').toLowerCase();

  $('eas-register-schema').disabled =
    !ownerReviewReady || state.reviewSchemaReady;
  $('eas-verify').disabled =
    !ownerReviewReady || !state.reviewSchemaReady;
  $('eas-decline').disabled =
    !ownerReviewReady || !state.reviewSchemaReady;
  $('eas-revoke').disabled =
    !ownerReviewReady || !state.reviewProof?.active;
  $('copy-review-uid').disabled =
    !state.reviewProof?.uid;
  $('metadata-image').disabled = state.busy || !metadataEnabled;
  $('publish-metadata').disabled = state.busy || !metadataEnabled;
  $('metadata-upload-help').textContent =
    !metadataEnabled ? 'Metadata publishing is currently disabled.' :
    !$('metadata-image').files?.length ? 'Choose a PNG, JPEG or WebP token image, then tap Publish.' :
    !state.wallet ? 'Tap Publish. PumpLite will request access to your Base wallet, then ask for authorization signatures. These signatures do not spend ETH.' :
    'Ready to publish with your connected wallet. Authorization signatures do not spend ETH.';
  $('chain').disabled = state.busy; $('connect').disabled = state.busy;
  $('create').disabled = state.busy || !transactionConfigEnabled(state.config, state.chain);
  $('trade').disabled = !writable() || !state.quote;
  $('create-action-status').textContent =
    state.chain !== 'base' || !transactionConfigEnabled(state.config, state.chain)
      ? 'Token creation is not enabled on this network.'
      : state.wallet
        ? 'Wallet connected: ' + state.wallet.slice(0, 6) + '…' + state.wallet.slice(-4) + '. Create coin will open the optional first-buy step.'
        : 'Create coin is ready. If needed, tapping it will request access to your Base wallet first.';
  $('get-quote').disabled = !ready() || !state.market || state.busy;
  $('refresh').disabled = !ready() || state.busy; $('refresh-market').disabled = !ready() || state.busy;
  $('more').disabled = state.busy; $('verified-only').disabled = state.busy;
  $('show-create').disabled=state.busy; $('show-explore').disabled=state.busy;
  for (const id of ['description','image-uri','banner-uri','website','twitter','telegram','discord','name','symbol','uri','side','amount','slippage','market-address','initial-buy-eth','initial-buy-currency','trade-display-amount','trade-display-currency']) $(id).disabled = state.busy;
  $('trade-use-display').disabled = state.busy || $('side').value !== 'buy';
  $('initial-buy-submit').disabled = state.busy;
  $('initial-buy-close').disabled = state.busy;
  $('holder-claim-refresh').disabled =
    state.busy ||
    state.chain !== 'base' ||
    !holderClaimConfigured();

  $('holder-claim-button').disabled =
    state.busy ||
    state.chain !== 'base' ||
    !holderClaimConfigured() ||
    !state.wallet;
}
function holderClaimConfigured() {
  const value = state.config?.base?.holderClaim;

  return Boolean(
    value?.enabled === true &&
    typeof value.contract === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(value.contract) &&
    typeof value.token === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(value.token)
  );
}

async function refreshHolderClaim() {
  const progress = $('holder-claim-progress');

  if (
    state.chain !== 'base' ||
    !holderClaimConfigured()
  ) {
    progress.textContent =
      'Claim contract is prepared but is not deployed and funded yet. No claim transaction is available.';
    controls();
    return;
  }

  progress.textContent =
    'Reading the live PLITE claim contract from Base Mainnet...';

  const result =
    await (await getAdapter()).holderClaimStatus();

  const count = Number(result.claimCount);
  const max = Number(result.maxClaims);
  const remaining = Number(result.remaining);

  progress.textContent =
    count +
    '/' +
    max +
    ' wallet claims completed - ' +
    remaining +
    ' remaining.' +
    (result.claimed === true
      ? ' This connected wallet already claimed.'
      : '');

  controls();
}
function invalidateQuote() {
  state.quote = null;
  for (const id of ['quote-output','quote-min','quote-fee','quote-support']) $(id).textContent = '—';
  $('quote-age').textContent = 'Get a current quote before signing.';
  controls();
}

const MAYHEM_MANUAL_DELAY_SECONDS = 86_400;

function mayhemManualReady(market) {
  return Boolean(
    market?.contractVersion === 2 &&
    Number.isFinite(Number(market.launchedAt)) &&
    Math.floor(Date.now() / 1000) >=
      Number(market.launchedAt) +
      MAYHEM_MANUAL_DELAY_SECONDS
  );
}

function mayhemHelp(market) {
  const unlock =
    Number(market.launchedAt) +
    MAYHEM_MANUAL_DELAY_SECONDS;

  if (mayhemManualReady(market)) {
    return market.mayhemActive
      ? 'Manual Mayhem is ACTIVE. The controller wallet can turn it off.'
      : 'Manual Mayhem is unlocked. The controller wallet can turn it on.';
  }

  const remaining =
    Math.max(
      0,
      unlock - Math.floor(Date.now() / 1000)
    );

  const hours = Math.floor(remaining / 3600);
  const minutes =
    Math.ceil((remaining % 3600) / 60);

  return (
    (market.initialMayhem
      ? 'Initial Mayhem is controlled by the launch setting during the first 24 hours. '
      : 'Manual Mayhem is locked by the deployed contract for the first 24 hours. ') +
    'Manual controls unlock at ' +
    new Date(unlock * 1000).toLocaleString() +
    ' (about ' +
    hours +
    'h ' +
    minutes +
    'm).'
  );
}

async function refreshMarketAfterAction(id) {
  let lastError;

  for (
    const delay of [0, 450, 900, 1600]
  ) {
    if (delay) {
      await new Promise(resolve =>
        setTimeout(resolve, delay)
      );
    }

    try {
      await loadMarket(id);
      status(
        'Confirmed transaction reflected in the refreshed market.'
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw Error(
    'Transaction was confirmed, but the read-only market refresh is still catching up: ' +
    (lastError?.message || 'refresh unavailable') +
    '. No wallet transaction was retried.'
  );
}

let chartRequest = 0;

function clearMarketChart(message) {
  $('price-chart').replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'price-chart-empty';
  empty.textContent = message;
  $('price-chart').append(empty);
  $('price-chart-change').textContent = 'No trades yet';
  $('price-chart-change').className = 'chart-change';
  $('price-chart-status').textContent = message;
}

async function loadMarketChart(market) {
  const request = ++chartRequest;

  if (
    state.chain !== 'base' ||
    market.contractVersion !== 2
  ) {
    clearMarketChart(
      'Trade chart is available for Base V2 markets.'
    );
    return;
  }

  $('price-chart-status').textContent =
    'Loading recent real Trade events from Base Mainnet…';

  try {
    const trades =
      await (await getAdapter()).tradeHistory(
        market,
        120
      );

    if (
      request !== chartRequest ||
      state.market?.id !== market.id
    ) {
      return;
    }

    const summary =
      renderPriceChart(
        $('price-chart'),
        trades,
        market.symbol
      );

    if (!summary.count) {
      $('price-chart-change').textContent =
        'No trades yet';
      $('price-chart-change').className =
        'chart-change';
      $('price-chart-status').textContent =
        'No completed buy/sell Trade events were found in the bounded recent Base history.';
      return;
    }

    const change = summary.changePct;
    const direction =
      change > 0
        ? 'up'
        : change < 0
          ? 'down'
          : '';

    $('price-chart-change').className =
      'chart-change' +
      (direction ? ' ' + direction : '');

    $('price-chart-change').textContent =
      (change > 0 ? '+' : '') +
      change.toFixed(2) +
      '%';

    $('price-chart-status').textContent =
      summary.count +
      ' recent on-chain trades · latest execution price ' +
      summary.latestPrice.toPrecision(6) +
      ' ETH/' +
      market.symbol +
      '. Green segments moved up; red segments moved down.';
  } catch (error) {
    if (
      request !== chartRequest ||
      state.market?.id !== market.id
    ) {
      return;
    }

    clearMarketChart(
      'Recent trade history is temporarily unavailable: ' +
      (error?.message || 'read failed')
    );
  }
}
async function getAdapter() {
  if (state.adapter) return state.adapter;
  const chain = state.chain, epoch = state.epoch;
  if (chain === 'solana') { diagnostic('Loading Solana SDK…'); status('Loading Solana wallet support…'); }
  const module =
    chain === 'solana'
      ? await import('./adapters/solana.js')
      : state.config?.base?.contractVersion === 2
        ? await import('./adapters/base-v2.js')
        : await import('./adapters/base.js');
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
  $('distribution-label').textContent =
    distributed.toFixed(2) + '% distributed from the current token supply.';

  const baseV2 = m.contractVersion === 2;
  $('base-v2-market').hidden = !baseV2;
  $('base-v2-burn-form').hidden = !baseV2;

  if (baseV2) {
    $('v2-supply-status').textContent =
      (m.mintableAtLaunch ? 'Mintable' : 'Fixed / No Mint') +
      ' · current ' +
      formatUnits(m.supply, 18, 2) +
      ' · max ' +
      formatUnits(m.maxSupply, 18, 2) +
      (m.mintingLocked ? ' · minting locked' : '');

    $('v2-mayhem-status').textContent =
      m.mayhemActive ? 'ACTIVE' : 'OFF';

    $('v2-mayhem-help').textContent =
      mayhemHelp(m);

    $('v2-support-total').textContent =
      formatUnits(m.totalMarketSupport, 18) + ' ETH';

    $('v2-burned-total').textContent =
      formatUnits(m.totalBurned, 18, 2) + ' ' + m.symbol;

    const walletAddress = state.wallet?.toLowerCase();

    $('base-v2-creator').hidden =
      !walletAddress ||
      walletAddress !== String(m.creator).toLowerCase();

    $('base-v2-controller').hidden =
      !walletAddress ||
      walletAddress !== String(m.mayhemController).toLowerCase();
  } else {
    $('base-v2-creator').hidden = true;
    $('base-v2-controller').hidden = true;
  }

  const ownerWallet =
    state.wallet?.toLowerCase();

  const reviewOwner =
    state.chain === 'base' &&
    ownerWallet &&
    ownerWallet ===
      String(state.config.base.treasury).toLowerCase();

  $('owner-review-panel').hidden =
    !reviewOwner;

  $('owner-review-market').textContent =
    m.id;

  const c = state.config[state.chain];
  $('market-link').href = c.explorer + (state.chain === 'solana' ? '/account/' : '/address/') + m.id;
  $('token-link').href = c.explorer + '/token/' + m.token;
  $('amount-label').textContent = $('side').value === 'buy' ? 'Amount (' + m.unit + ')' : 'Amount (' + m.symbol + ')';
}
async function reconcilePortableReview(market) {
  state.reviewProof = null;

  if (state.chain !== 'base' || !state.registry?.base) return;

  const key = market.id.toLowerCase();
  const entry = state.registry.base[key];
  if (!entry?.easUid) return;

  try {
    const proof = await (await getAdapter()).reviewAttestation(entry.easUid);
    const expectedDecision = entry.status === 'verified' ? 'verified' : 'declined';
    const valid =
      proof.active &&
      proof.decision === expectedDecision &&
      proof.schema === state.adapter.reviewSchemaUid() &&
      proof.attester.toLowerCase() === String(state.config.base.treasury).toLowerCase() &&
      proof.recipient.toLowerCase() === market.token.toLowerCase() &&
      proof.market.toLowerCase() === market.id.toLowerCase() &&
      proof.token.toLowerCase() === market.token.toLowerCase() &&
      proof.creator.toLowerCase() === market.creator.toLowerCase() &&
      proof.factory.toLowerCase() === String(state.config.base.factory).toLowerCase();

    if (!valid) throw Error('portable EAS proof no longer matches this market');
    state.reviewProof = proof;
  } catch (error) {
    const next = { version: 1, base: { ...state.registry.base } };
    delete next.base[key];
    state.registry = next;
    status(
      'PumpLite review mirror was hidden because its portable Base EAS proof could not be validated: ' +
      (error?.message || 'verification unavailable')
    );
  }
}

function showReviewProof(proof) {
  state.reviewProof = proof || null;
  const box = $('eas-proof');

  if (!proof?.uid) {
    box.hidden = true;
    $('eas-review-uid').textContent = '';
    $('eas-review-link').removeAttribute('href');
    $('eas-review-status').textContent =
      'No owner attestation has been selected for this review yet.';
    controls();
    return;
  }

  box.hidden = false;
  $('eas-review-uid').textContent = proof.uid;
  $('eas-review-link').href =
    'https://base.easscan.org/attestation/view/' + encodeURIComponent(proof.uid);

  $('eas-review-status').textContent =
    proof.active
      ? 'Public Base EAS review: ' + proof.decision.toUpperCase() + '. Copy this UID into the protected GitHub review workflow to publish the matching PumpLite badge.'
      : 'This Base EAS review proof is revoked/inactive. Use the GitHub review workflow with Revoke to remove its PumpLite mirror.';

  controls();
}

async function loadOwnerReviewTools(market) {
  const isOwner =
    state.chain === 'base' &&
    state.wallet &&
    state.wallet.toLowerCase() === String(state.config.base.treasury).toLowerCase();

  if (!isOwner || market.contractVersion !== 2) {
    state.reviewSchemaReady = false;
    controls();
    return;
  }

  const schema = await (await getAdapter()).reviewSchemaStatus();
  state.reviewSchemaReady = schema.registered;
  $('eas-schema-status').textContent =
    schema.registered
      ? 'PumpLite portable review schema is registered on Base EAS · ' + schema.uid
      : 'PumpLite portable review schema is not registered yet. Registering it is a one-time Base transaction and uses network gas.';

  showReviewProof(state.reviewProof);
  controls();
}

async function loadMarket(id) {
  requireDeployment(); invalidateQuote();
  state.market = null;
  $('market-badges').replaceChildren(); $('verification-details').replaceChildren();
  $('verification-state').textContent='Checking live factory provenance and the owner review list…';
  $('balance').textContent = 'Connect a wallet to read balances.';
  const m = await (await getAdapter()).market(id);
  await refreshRegistry();
  await reconcilePortableReview(m);
  state.market = m; renderMarket(m);
  if (state.wallet) {
    const balances = await state.adapter.balances(m);
    $('balance').textContent = 'Wallet: ' + formatUnits(balances.native, m.nativeDecimals) + ' ' + m.unit +
      ' · ' + formatUnits(balances.tokens, m.decimals) + ' ' + m.symbol + ' (network costs additional)';
  }

  void loadMarketChart(m);
  void loadOwnerReviewTools(m).catch(error => {
    $('eas-schema-status').textContent =
      'Portable review tools are temporarily unavailable: ' +
      (error?.message || 'read failed');
  });
}
async function route() {
  chartRequest++;
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
async function connectBaseWalletFromGesture() {
  if (state.wallet) return state.wallet;
  if (state.chain !== 'base') throw Error('Select Base Mainnet first');

  wallets.refresh();

  const index = Number($('wallet-choice').value);
  let selected =
    Number.isInteger(index)
      ? wallets.entries[index]?.provider
      : null;

  // Coinbase Wallet and some mobile wallet browsers expose only window.ethereum.
  // This is still used only after the user taps Connect/Publish/Create.
  if (
    !selected &&
    typeof window.ethereum?.request === 'function'
  ) {
    selected = window.ethereum;
  }

  status('Requesting access to your Base wallet…');

  const address =
    await (await getAdapter()).connect(selected);

  state.wallet = address;
  $('connect').textContent =
    'Disconnect ' +
    address.slice(0, 5) +
    '…' +
    address.slice(-4);

  status('Wallet connected: ' + address);

  void refreshHolderClaim().catch(error => {
    holder-claim-progress.textContent =
      'Claim status unavailable: ' + (error?.message || 'read failed');
  });

  if (
    state.market ||
    location.hash.startsWith('#base/')
  ) {
    $('balance').textContent =
      'Wallet connected. Loading Base market and token balances…';
  }

  return address;
}

$('holder-claim-refresh').addEventListener(
  'click',
  () => action(refreshHolderClaim)
);

$('holder-claim-button').addEventListener(
  'click',
  () => action(async () => {
    if (!state.wallet) {
      await connectBaseWalletFromGesture();
    }

    requireWrite();

    const result =
      await (await getAdapter()).claimHolderToken();

    $('holder-claim-progress').textContent =
      Number(result.claimCount) +
      '/' +
      Number(result.maxClaims) +
      ' wallet claims completed - ' +
      Number(result.remaining) +
      ' remaining. This wallet has claimed 1 PLITE.';

    controls();
  })
);
$('connect').addEventListener('click', () => action(async () => {
  if (state.wallet) {
    state.adapter?.disconnect();
    status('Wallet disconnected from this site.');
    return;
  }

  if (state.chain === 'solana') {
    diagnostic('Connect tapped');

    if (!phantomPrepared) {
      try {
        await (await getAdapter()).prepareConnect();
        phantomPrepared = true;
      } catch (error) {
        diagnostic(error.message);
        throw error;
      }
      return;
    }

    phantomPrepared = false;

    try {
      state.wallet = await state.adapter.connect(true);
    } catch (error) {
      diagnostic(error.message);
      throw error;
    }

    $('connect').textContent =
      'Disconnect ' +
      state.wallet.slice(0, 5) +
      '…' +
      state.wallet.slice(-4);

    status('Wallet connected: ' + state.wallet);

    const solanaWrites =
      transactionConfigEnabled(state.config, 'solana');

    diagnostic(
      solanaWrites
        ? 'Wallet connected. Checking Mainnet RPC.'
        : 'Wallet connected. Checking Mainnet RPC; Solana transactions remain disabled.'
    );

    try {
      await state.adapter.verifyNetwork();
      diagnostic(
        solanaWrites
          ? 'Wallet connected. Mainnet RPC verified.'
          : 'Wallet connected. Mainnet RPC verified. Solana transactions remain disabled.'
      );
    } catch (error) {
      diagnostic(
        'Wallet connected for account access only. Mainnet RPC NOT verified: ' +
        error.message +
        '. On-chain operations remain blocked until verification succeeds.'
      );
    }
  } else {
    await connectBaseWalletFromGesture();
  }

  const routeParts =
    location.hash.slice(1).split('/');

  const routeMarketId =
    routeParts[0] === 'base' && routeParts[1]
      ? decodeURIComponent(routeParts[1])
      : null;

  const marketId =
    state.market?.id || routeMarketId;

  if (marketId) {
    await loadMarket(marketId);
  }
}));
$('copy-review-market').addEventListener(
  'click',
  () => action(async () => {
    if (!state.market) throw Error('Open a market first');
    await copyMetadataText(state.market.id);
    status('Market address copied for the protected PumpLite review workflow.');
  })
);

$('copy-review-uid').addEventListener(
  'click',
  () => action(async () => {
    if (!state.reviewProof?.uid) throw Error('Publish or load an EAS review proof first');
    await copyMetadataText(state.reviewProof.uid);
    status('EAS attestation UID copied. Paste it into the protected GitHub review workflow.');
  })
);

$('eas-register-schema').addEventListener('click', () => action(async () => {
  requireWrite();
  const result = await state.adapter.registerReviewSchema();
  state.reviewSchemaReady = result.registered;
  $('eas-schema-status').textContent =
    'PumpLite portable review schema is registered on Base EAS · ' + result.uid;
  controls();
}));

$('eas-verify').addEventListener('click', () => action(async () => {
  requireWrite();
  if (!state.market) throw Error('Open a market first');
  if (!window.confirm('Publish a public Verified by PumpLite identity/provenance attestation for this token on Base? This uses Base gas and is not an investment endorsement.')) return;
  const proof = await state.adapter.publishReviewAttestation(state.market, 'verified');
  showReviewProof(proof);
  status('Verified by PumpLite EAS proof published on Base. Now mirror this UID with the protected GitHub review workflow.');
}));

$('eas-decline').addEventListener('click', () => action(async () => {
  requireWrite();
  if (!state.market) throw Error('Open a market first');
  if (!window.confirm('Publish a public PumpLite identity/provenance review decline for this token on Base? This uses Base gas and does not label the token a scam.')) return;
  const proof = await state.adapter.publishReviewAttestation(state.market, 'declined');
  showReviewProof(proof);
  status('Declined review EAS proof published on Base. Now mirror this UID with the protected GitHub review workflow.');
}));

$('eas-revoke').addEventListener('click', () => action(async () => {
  requireWrite();
  if (!state.reviewProof?.uid) throw Error('No EAS review proof is loaded');
  if (!window.confirm('Revoke this PumpLite EAS review proof on Base? Revocation uses Base gas.')) return;
  const proof = await state.adapter.revokeReviewAttestation(state.reviewProof.uid);
  showReviewProof(proof);
  status('PumpLite EAS review proof revoked. Run the protected GitHub review workflow with Revoke to remove the mirrored badge.');
}));

async function copyMetadataText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.append(area);
  area.select();

  let copied = false;

  try {
    copied = document.execCommand('copy');
  } finally {
    area.remove();
  }

  if (!copied) {
    throw Error('This browser blocked clipboard access. Open PumpLite in a normal browser or copy the Published metadata URI after IPFS publishing.');
  }
}

$('download-metadata').addEventListener('click', () => action(async () => {
  const text = metadataDocument(
    $('name').value.trim(),
    $('symbol').value.trim(),
    $('description').value,
    $('image-uri').value.trim(),
    projectLinks(),
    $('banner-uri').value.trim()
  );

  await copyMetadataText(text);

  $('metadata-publish-status').textContent =
    'Metadata JSON copied to your clipboard. This backup does not publish or create the token.';

  status(
    'Metadata JSON copied to clipboard. Publish to IPFS before creating the token.'
  );
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
  const inline = $('metadata-publish-status');

  try {
    if (state.config?.metadataUploads?.enabled !== true) {
      throw Error('Metadata uploads are not enabled');
    }

    const image = $('metadata-image').files?.[0];

    if (!image) {
      inline.textContent = 'Choose a PNG, JPEG or WebP token image first.';
      throw Error('Choose a token image first');
    }

    if (!state.wallet && state.chain === 'base') {
      inline.textContent = 'Requesting access to your Base wallet…';
      await connectBaseWalletFromGesture();
    }

    if (!state.wallet) {
      throw Error('Connect a wallet first');
    }

    inline.textContent =
      'Preparing secure IPFS publishing…';

    const adapter = await getAdapter();

    if (typeof adapter.signMetadataMessage !== 'function') {
      throw Error(
        'Connected wallet does not support metadata authorization'
      );
    }

    const { uploadTokenMetadata } =
      await import('./metadata-auth-client.js');

    const result = await uploadTokenMetadata({
      enabled: true,
      chain: state.chain,
      subject: state.wallet,
      signMessage: message =>
        adapter.signMetadataMessage(message),
      image,
      name: $('name').value.trim(),
      symbol: $('symbol').value.trim(),
      description: $('description').value,
      links: projectLinks(),
      banner: $('banner-uri').value.trim(),
      onProgress: message => {
        inline.textContent = message;
        status(message);
      }
    });

    $('image-uri').value = result.image.uri;
    $('uri').value = result.metadata.uri;
    publishedDraft = draftIdentity();

    inline.textContent =
      'Published successfully. Image and metadata IPFS addresses are ready.';

    status(
      'Metadata published to IPFS. Metadata URI is ready.'
    );

    controls();
  } catch (error) {
    const message =
      error?.shortMessage ||
      error?.message ||
      'Metadata publishing could not complete';

    inline.textContent =
      'Publish failed: ' + message;

    throw error;
  }
}));

$('show-create').addEventListener('click',()=>{$('create-section').scrollIntoView({block:'start'});$('name').focus();});
$('show-explore').addEventListener('click',()=>{$('explore-section').scrollIntoView({block:'start'});$('explore-section').focus();});
$('verified-only').addEventListener('change',()=>action(async()=>{state.registry=null;renderDiscovery();await refreshRegistry();renderDiscovery();}));

$('refresh').addEventListener('click', () => action(() => discover()));
$('more').addEventListener('click', () => action(() => discover(true)));
$('refresh-market').addEventListener('click', () => action(() => loadMarket(state.market?.id || decodeURIComponent(location.hash.split('/')[1]))));
$('open-form').addEventListener('submit', e => { e.preventDefault(); if (!state.busy) location.hash = state.chain + '/' + encodeURIComponent($('market-address').value.trim()); });
function creationData() {
  const data = {
    name: $('name').value.trim(),
    symbol: $('symbol').value.trim(),
    uri: $('uri').value.trim()
  };

  if (
    state.chain !== 'base' ||
    state.config?.base?.contractVersion !== 2
  ) {
    throw Error('Token creation is currently available on Base V2 only');
  }

  const mintable =
    $('v2-supply-mode').value === 'mintable';

  const initialSupply =
    parseUnits($('v2-initial-supply').value.trim(), 18);

  const maxSupply =
    mintable
      ? parseUnits($('v2-max-supply').value.trim(), 18)
      : initialSupply;

  const minimum =
    1_000_000_000n * 10n ** 18n;

  const maximum =
    1_000_000_000_000_000n * 10n ** 18n;

  if (
    initialSupply < minimum ||
    initialSupply > maxSupply ||
    maxSupply > maximum
  ) {
    throw Error(
      'Supply must be between 1 billion and 1 quadrillion tokens, and maximum supply cannot be below initial supply.'
    );
  }

  data.initialSupply = initialSupply;
  data.maxSupply = maxSupply;
  data.mintable = mintable;
  data.initialMayhem =
    $('v2-initial-mayhem').checked;

  validateMetadata(
    data.name,
    data.symbol,
    data.uri
  );

  const extras =
    metadataExtras(
      projectLinks(),
      $('banner-uri').value.trim()
    );

  if (
    !data.uri &&
    (
      $('description').value ||
      $('metadata-image').files?.length ||
      Object.keys(extras).length ||
      $('image-uri').value
    )
  ) {
    throw Error(
      'Publish image + metadata to IPFS first. The Published metadata URI must be filled before this token can be created.'
    );
  }

  return data;
}

function updateInitialBuySymbol() {
  $('initial-buy-symbol').textContent =
    $('symbol').value.trim() || 'TOKEN';
}

let initialBuyRates = null;
let initialBuyRatesAt = 0;
let initialBuyEstimateSequence = 0;

function formatInitialBuyFiat(value, currency) {
  return new Intl.NumberFormat(
    currency === 'NZD' ? 'en-NZ' : 'en-US',
    {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    }
  ).format(value);
}

async function loadInitialBuyRates() {
  if (
    initialBuyRates &&
    Date.now() - initialBuyRatesAt < 60_000
  ) return initialBuyRates;

  const response = await fetch(
    'https://api.coinbase.com/v2/exchange-rates?currency=ETH',
    {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    }
  );

  if (!response.ok) {
    throw Error('Live fiat estimate unavailable');
  }

  const value = await response.json();
  const nzd = Number(value?.data?.rates?.NZD);
  const usd = Number(value?.data?.rates?.USD);
  const btc = Number(value?.data?.rates?.BTC);
  const sol = Number(value?.data?.rates?.SOL);
  const doge = Number(value?.data?.rates?.DOGE);

  if (
    !Number.isFinite(nzd) ||
    !Number.isFinite(usd) ||
    nzd <= 0 ||
    usd <= 0
  ) {
    throw Error('Live fiat estimate unavailable');
  }

  initialBuyRates = {
    NZD: nzd,
    USD: usd,
    BTC: btc,
    SOL: sol,
    DOGE: doge
  };
  initialBuyRatesAt = Date.now();
  return initialBuyRates;
}

async function updateInitialBuyEstimate() {
  const sequence = ++initialBuyEstimateSequence;
  const text = $('initial-buy-eth').value.trim() || '0';
  const amount = Number(text);
  const currency = $('initial-buy-currency').value;
  const output = $('initial-buy-fiat-estimate');

  $('initial-buy-submit').textContent =
    Number.isFinite(amount) && amount > 0
      ? 'Create coin + buy'
      : 'Create coin only';

  if (!Number.isFinite(amount) || amount < 0) {
    output.textContent =
      'Enter a valid ETH amount. The transaction itself is always in ETH.';
    return;
  }

  if (amount === 0) {
    output.textContent =
      '0 ETH · creation only. Base gas still applies.';
    return;
  }

  output.textContent =
    'Loading approximate ' + currency + ' value…';

  try {
    const rates = await loadInitialBuyRates();
    if (sequence !== initialBuyEstimateSequence) return;

    output.textContent =
      text +
      ' ETH ≈ ' +
      formatInitialBuyFiat(amount * rates[currency], currency) +
      ' (approximate). The wallet transaction is still in ETH.';
  } catch {
    if (sequence !== initialBuyEstimateSequence) return;

    output.textContent =
      'Fiat estimate is temporarily unavailable. The ETH amount is unchanged.';
  }
}

$('initial-buy-eth').addEventListener(
  'input',
  () => void updateInitialBuyEstimate()
);

$('initial-buy-currency').addEventListener(
  'change',
  () => void updateInitialBuyEstimate()
);

let tradeDisplaySequence = 0;

function syncTradeHelperMode() {
  const buying = $('side').value === 'buy';
  $('trade-spend-field').hidden = !buying;
  $('trade-use-display').hidden = !buying;
  $('trade-use-display').disabled = state.busy || !buying;

  if (buying) {
    if (!$('trade-display-amount').value.trim()) {
      $('trade-display-estimate').textContent =
        'Enter a buy value to calculate an approximate Base ETH amount.';
    }
  } else {
    $('trade-display-estimate').textContent =
      'Get a sell quote below to see the approximate payout value. The real on-chain payout is Base ETH.';
  }
}

function normalizeTradeEth(value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw Error('Enter an amount greater than 0');
  }

  const text = value
    .toFixed(18)
    .replace(/0+$/, '')
    .replace(/\.$/, '');

  if (!text || text === '0') {
    throw Error('Amount is too small to convert to ETH');
  }

  return text;
}

function formatTradeDisplay(value, currency) {
  if (currency === 'NZD' || currency === 'USD') {
    return formatInitialBuyFiat(value, currency);
  }

  const max =
    currency === 'BTC' ? 10 :
    currency === 'SOL' ? 8 :
    currency === 'DOGE' ? 4 :
    8;

  return new Intl.NumberFormat(
    'en-US',
    { maximumFractionDigits: max }
  ).format(value) + ' ' + currency;
}

async function tradeDisplayEthAmount() {
  const text = $('trade-display-amount').value.trim();
  const source = $('trade-display-currency').value;
  const amount = Number(text);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw Error('Enter a valid amount greater than 0');
  }

  if (source === 'ETH') {
    return normalizeTradeEth(amount);
  }

  const rates = await loadInitialBuyRates();
  const rate = Number(rates[source]);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw Error('Live ' + source + ' to ETH estimate is temporarily unavailable');
  }

  return normalizeTradeEth(amount / rate);
}

async function updateTradeBuyEstimate() {
  const sequence = ++tradeDisplaySequence;
  syncTradeHelperMode();

  if ($('side').value !== 'buy') return;

  const output = $('trade-display-estimate');
  const text = $('trade-display-amount').value.trim();

  if (!text) {
    output.textContent =
      'Enter a buy value to calculate an approximate Base ETH amount.';
    return;
  }

  const source = $('trade-display-currency').value;
  const amount = Number(text);

  if (!Number.isFinite(amount) || amount <= 0) {
    output.textContent = 'Enter a valid amount greater than 0.';
    return;
  }

  output.textContent =
    'Loading approximate ' + source + ' to Base ETH value...';

  try {
    const ethText = await tradeDisplayEthAmount();
    if (sequence !== tradeDisplaySequence) return;

    const nativeNote =
      ['BTC', 'SOL', 'DOGE'].includes(source)
        ? ' Native ' + source + ' must be converted to Base ETH before the PumpLite transaction.'
        : '';

    output.textContent =
      formatTradeDisplay(amount, source) +
      ' is about ' +
      ethText +
      ' Base ETH.' +
      nativeNote;
  } catch (error) {
    if (sequence !== tradeDisplaySequence) return;
    output.textContent =
      error?.message ||
      'Live conversion estimate is temporarily unavailable.';
  }
}

async function updateTradeSellDisplay(ethOutput) {
  if ($('side').value !== 'sell') return;

  const sequence = ++tradeDisplaySequence;
  const output = $('trade-display-estimate');
  const currency = $('trade-display-currency').value;
  const eth = Number(ethOutput);

  if (!Number.isFinite(eth) || eth <= 0) {
    output.textContent =
      'Get a sell quote below to see the approximate payout value. The real on-chain payout is Base ETH.';
    return;
  }

  if (currency === 'ETH') {
    output.textContent =
      'Approximate quoted payout: ' +
      formatTradeDisplay(eth, 'ETH') +
      '. The real on-chain payout is Base ETH.';
    return;
  }

  output.textContent =
    'Loading approximate sell payout in ' + currency + '...';

  try {
    const rates = await loadInitialBuyRates();
    if (sequence !== tradeDisplaySequence) return;

    const rate = Number(rates[currency]);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw Error('Live ' + currency + ' estimate is temporarily unavailable');
    }

    const converted = eth * rate;
    const nativeNote =
      ['BTC', 'SOL', 'DOGE'].includes(currency)
        ? ' To receive native ' + currency + ', convert the Base ETH after the PumpLite sale.'
        : '';

    output.textContent =
      'Approximate quoted payout: ' +
      formatTradeDisplay(converted, currency) +
      ' from ' +
      normalizeTradeEth(eth) +
      ' Base ETH.' +
      nativeNote;
  } catch (error) {
    if (sequence !== tradeDisplaySequence) return;
    output.textContent =
      error?.message ||
      'Live sell conversion estimate is temporarily unavailable.';
  }
}

$('trade-display-amount').addEventListener(
  'input',
  () => void updateTradeBuyEstimate()
);

$('trade-display-currency').addEventListener(
  'change',
  () => {
    if ($('side').value === 'buy') {
      void updateTradeBuyEstimate();
    } else if (state.quote?.side === 'sell') {
      const decimals = state.market?.nativeDecimals ?? 18;
      const ethOutput = Number(formatUnits(state.quote.output, decimals, decimals));
      void updateTradeSellDisplay(ethOutput);
    }
  }
);

$('side').addEventListener(
  'change',
  () => {
    syncTradeHelperMode();
    if ($('side').value === 'buy') {
      void updateTradeBuyEstimate();
    }
  }
);

$('trade-use-display').addEventListener(
  'click',
  () => action(async () => {
    if ($('side').value !== 'buy') {
      throw Error('Quick value conversion is for buys only');
    }

    const ethText = await tradeDisplayEthAmount();
    $('amount').value = ethText;
    invalidateQuote();

    if (state.market) {
      renderMarket(state.market);
    }

    status(
      'Buy amount set to ' +
      ethText +
      ' Base ETH. Get a current quote before signing.'
    );

    $('amount').focus();
  })
);

syncTradeHelperMode();
$('symbol').addEventListener(
  'input',
  updateInitialBuySymbol
);

$('initial-buy-close').addEventListener(
  'click',
  () => $('initial-buy-dialog').close()
);

$('create-form').addEventListener('submit', e => {
  e.preventDefault();

  action(async () => {
    const inline = $('create-action-status');

    try {
      // Validate everything before requesting wallet access.
      creationData();

      if (!state.wallet) {
        inline.textContent =
          'Requesting access to your Base wallet…';
        await connectBaseWalletFromGesture();
      }

      requireWrite();

      updateInitialBuySymbol();
      $('initial-buy-eth').value = '0';
      $('initial-buy-currency').value = 'NZD';
      $('initial-buy-flow-status').textContent =
        'Nothing has been submitted yet.';
      void updateInitialBuyEstimate();

      inline.textContent =
        'Wallet ready. Choose 0 ETH to create only, or enter an optional first-buy amount.';

      $('initial-buy-dialog').showModal();
    } catch (error) {
      inline.textContent =
        'Action stopped: ' +
        (
          error?.shortMessage ||
          error?.message ||
          'Unable to continue'
        );
      throw error;
    }
  });
});

$('initial-buy-form').addEventListener('submit', e => {
  e.preventDefault();

  action(async () => {
    const inline = $('create-action-status');
    const flow = $('initial-buy-flow-status');
    let createdId = null;

    try {
      if (!state.wallet) {
        inline.textContent =
          'Requesting access to your Base wallet…';
        await connectBaseWalletFromGesture();
      }

      requireWrite();

      const data = creationData();

      const initialBuyText =
        $('initial-buy-eth').value.trim() || '0';

      const initialBuy =
        /^(?:0+)(?:\.0+)?$/.test(initialBuyText)
          ? 0n
          : parseUnits(initialBuyText, 18);

      if (initialBuy < 0n) {
        throw Error(
          'Optional first buy cannot be negative'
        );
      }

      const adapter = await getAdapter();

      flow.textContent =
        'Step 1: review token creation in your wallet. This dialog will stay here until the result is known.';

      inline.textContent =
        'Review token creation in your wallet. PumpLite creation fee is 0%; Base gas still applies.';

      createdId = await adapter.create(data);

      if (initialBuy > 0n) {
        flow.textContent =
          'Token created. Preparing your optional first buy with the same wallet…';

        inline.textContent =
          'Token created. Your same wallet will now show the optional buy confirmation.';

        const market =
          await adapter.market(createdId);

        const q =
          quoteBaseV2(
            market,
            'buy',
            initialBuy
          );

        const min =
          minimumOutput(q.output, 100);

        flow.textContent =
          'Step 2: review the optional buy in your wallet.';

        await adapter.trade(
          market,
          'buy',
          initialBuy,
          min
        );
      }

      inline.textContent =
        initialBuy > 0n
          ? 'Token created and optional first buy confirmed.'
          : 'Token created. No optional first buy was requested.';

      flow.textContent =
        initialBuy > 0n
          ? 'Finished: token created and first buy confirmed.'
          : 'Finished: token created only.';

      $('initial-buy-dialog').close();

      const routeHash =
        state.chain + '/' + encodeURIComponent(createdId);

      location.hash = routeHash;

      if (
        location.hash === '#' + routeHash &&
        state.busy
      ) {
        state.pendingRoute = true;
      }
    } catch (error) {
      const message =
        error?.shortMessage ||
        error?.message ||
        'Unable to continue';

      if (createdId) {
        inline.textContent =
          'Your token was created, but the optional first buy did not complete: ' +
          message;

        flow.textContent =
          'The token exists. PumpLite will open its market page; you can buy later from there.';

        $('initial-buy-dialog').close();

        const routeHash =
          state.chain + '/' + encodeURIComponent(createdId);

        location.hash = routeHash;

        if (
          location.hash === '#' + routeHash &&
          state.busy
        ) {
          state.pendingRoute = true;
        }

        status(
          'Token created successfully. Optional first buy did not complete: ' +
          message
        );

        return;
      }

      flow.textContent =
        'Creation did not complete: ' +
        message +
        '. Nothing was created. This dialog stays open so you can retry or close it.';

      inline.textContent =
        'Action stopped: ' + message;

      throw error;
    }
  });
});
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
  const q =
    m.contractVersion === 2
      ? quoteBaseV2(m, side, amount)
      : quote(m, side, amount);

  const min = minimumOutput(q.output, slippageBps);
  const decimals = side === 'buy' ? m.decimals : m.nativeDecimals, unit = side === 'buy' ? m.symbol : m.unit;
  state.quote = { ...q, min, amount, side, at: Date.now(), market: m.id, chain: state.chain };
  $('quote-output').textContent = formatUnits(q.output, decimals, decimals) + ' ' + unit;
  $('quote-min').textContent = formatUnits(min, decimals, decimals) + ' ' + unit;
  $('quote-fee').textContent =
    formatUnits(q.fee, m.nativeDecimals, m.nativeDecimals) + ' ' + m.unit;

  $('quote-support-row').hidden = m.contractVersion !== 2;

  $('quote-support').textContent =
    m.contractVersion === 2
      ? formatUnits(q.support, m.nativeDecimals, m.nativeDecimals) + ' ' + m.unit
      : '—';
  $('quote-age').textContent = 'Quoted at ' + new Date().toLocaleTimeString() + '. Valid for review for 30 seconds; chain slippage protection still applies.';

  if (side === 'sell') {
    void updateTradeSellDisplay(
      Number(formatUnits(q.output, m.nativeDecimals, m.nativeDecimals))
    );
  }
}));
$('trade-form').addEventListener('submit', e => { e.preventDefault(); action(async () => {
  requireWrite();
  const q = state.quote;
  if (!q || Date.now() - q.at > 30_000 || q.market !== state.market?.id || q.chain !== state.chain) {
    invalidateQuote(); throw Error('Quote expired. Request a fresh quote.');
  }
  invalidateQuote();
  await (await getAdapter()).trade(state.market, q.side, q.amount, q.min);
  await refreshMarketAfterAction(state.market.id);
}); });
$('v2-supply-mode').addEventListener('change', controls);

$('base-v2-burn-form').addEventListener('submit', e => {
  e.preventDefault();

  action(async () => {
    requireWrite();

    if (state.market?.contractVersion !== 2) {
      throw Error('Buy & Burn requires a Base V2 market');
    }

    const amount = parseUnits($('v2-burn-amount').value.trim(), 18);
    const raw = Number($('v2-burn-slippage').value) * 100;
    const slippageBps = Math.round(raw);

    if (Math.abs(raw - slippageBps) > 1e-7) {
      throw Error('Slippage supports two decimal places');
    }

    const fresh = await (await getAdapter()).market(state.market.id);
    const q = quoteBaseV2(fresh, 'buy', amount);
    const min = minimumOutput(q.output, slippageBps);

    await state.adapter.buyAndBurn(fresh, amount, min);
    await refreshMarketAfterAction(fresh.id);
  });
});

$('v2-mint-form').addEventListener('submit', e => {
  e.preventDefault();

  action(async () => {
    requireWrite();

    const amount = parseUnits($('v2-mint-amount').value.trim(), 18);

    await state.adapter.mintInventory(state.market, amount);
    await refreshMarketAfterAction(state.market.id);
  });
});

$('v2-lock-minting').addEventListener('click', () => action(async () => {
  requireWrite();

  if (!window.confirm('Permanently disable all future minting? This cannot be undone.')) return;

  await state.adapter.lockMinting(state.market);
  await refreshMarketAfterAction(state.market.id);
}));

$('v2-mayhem-on').addEventListener('click', () => action(async () => {
  requireWrite();
  await state.adapter.setMayhem(state.market, true);
  await refreshMarketAfterAction(state.market.id);
}));

$('v2-mayhem-off').addEventListener('click', () => action(async () => {
  requireWrite();
  await state.adapter.setMayhem(state.market, false);
  await refreshMarketAfterAction(state.market.id);
}));

$('v2-support-form').addEventListener('submit', e => {
  e.preventDefault();

  action(async () => {
    requireWrite();

    const amount = parseUnits($('v2-support-amount').value.trim(), 18);

    await state.adapter.supportMarket(state.market, amount);
    await refreshMarketAfterAction(state.market.id);
  });
});

window.addEventListener('hashchange', () => {
  // Route after an in-flight operation settles; never change transaction context mid-signature.
  if (!state.busy) action(route); else state.pendingRoute = true;
});
function walletChanged() {
  phantomPrepared = false;
  state.wallet = null; $('connect').textContent = 'Connect wallet'; invalidateQuote();
  $('balance').textContent = 'Wallet changed. Reconnect to read balances.';
  holder-claim-progress.textContent =
    holderClaimConfigured()
      ? 'Claim status will refresh after reconnect.'
      : 'Claim contract is prepared but is not deployed and funded yet. No claim transaction is available.';
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
async function loadPublicConfig() {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(
        './config.json?boot=20260930d&attempt=' + attempt,
        { cache: 'no-store' }
      );

      if (!response.ok) {
        throw Error(
          'Configuration request failed (HTTP ' +
          response.status +
          ')'
        );
      }

      return validatePublicConfig(
        await response.json()
      );
    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await new Promise(resolve =>
          setTimeout(resolve, 300)
        );
      }
    }
  }

  throw lastError ||
    Error('Unable to load public network configuration');
}

try {
  $('deployment').textContent =
    'Loading verified Base Mainnet configuration…';

  state.config = await loadPublicConfig();

  switchChain('base');
  await action(route);

  document.documentElement.dataset.walletAppReady =
    'ready';
} catch (error) {
  $('deployment').textContent =
    'Base Mainnet configuration could not load. Trading remains disabled until this is fixed.';

  status(
    error.message ||
    'Unable to load public network configuration'
  );

  controls();
}
