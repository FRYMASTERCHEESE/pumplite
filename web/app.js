import { launchStage } from './launch-retry.js';
import { metadataExtras, LINK_FIELDS } from './metadata-fields.js';
import { tokenTrust } from './verification.js';
import { loadReviewedRegistry, badges, verificationPanel } from './verification-ui.js';
import { discoverEvm, solanaDiagnostics } from './wallets.js';
import { mobileBrowseLink } from './mobile.js';
import { metadataDocument } from './metadata.js';
import { parseUnits, formatUnits, quote, quoteBaseV2, minimumOutput, validateMetadata } from './math.js';
import { validatePublicConfig, deploymentConfigured, transactionConfigEnabled } from './release-config.js';
import { renderPriceChart } from './price-chart.js';
import { loadTokenMedia } from './token-media.js';
import { renderTokenDetailCard } from './token-detail-card.js';
if (window.top !== window.self) {
  document.body.replaceChildren(document.createTextNode('Open PumpLite directly in your browser. Embedded wallet interactions are disabled.'));
  throw Error('Embedded PumpLite is disabled');
}
const $ = id => document.getElementById(id);
$('skip-content').addEventListener('click', event => { event.preventDefault(); $('main-content').focus(); });
const PLITE_MARKET_ADDRESS = '0xa522A4Ef81fD31daec390ab46A32D4886e1461C7';
const PLITE_MARKET_ID = PLITE_MARKET_ADDRESS.toLowerCase();
const PLITE_UNISWAP_V2_PAIR_ADDRESS = '0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086';
const BASE_WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
const state = { config: null, chain: 'base', adapter: null, wallet: null, market: null, quote: null, busy: false, epoch: 0, next: null, markets: [], pendingLaunches: [], featuredPlite: null, registry: null, reviewProof: null, reviewSchemaReady: false, platformStats: null };
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
  const phLink = state.chain === 'base' ? mobileBrowseLink('base', location.href, 'phantom') : null;
  $('mobile-phantom').hidden = !phLink || state.busy;
  if (phLink) $('mobile-phantom').href = phLink;
  const cbLink = state.chain === 'base' ? mobileBrowseLink('base', location.href, 'coinbase') : null;
  $('mobile-coinbase').hidden = !cbLink || state.busy;
  if (cbLink) $('mobile-coinbase').href = cbLink;
  $('wallet-choice-label').hidden = state.chain !== 'base';
  $('wallet-choice').disabled = state.busy || Boolean(state.wallet);
  $('download-metadata').disabled = state.busy;
  const metadataEnabled = state.config?.metadataUploads?.enabled === true;

  const baseVersion =
    Number(state.config?.base?.contractVersion || 0);

  const baseV2 =
    state.chain === 'base' &&
    baseVersion === 2;

  const baseV3 =
    state.chain === 'base' &&
    baseVersion === 3;

  const baseModern =
    baseV2 || baseV3;

  $('base-v2-create-options').hidden = !baseModern;
  $('base-v3-mode-options').hidden = !baseV3;

  if (state.chain === 'solana' || $('solana-mayhem')) void import('./mayhem-ui.js').then(m => m.syncMayhem(state, getAdapter, action));
  $('v2-initial-mayhem-row').hidden = baseV3;
  $('base-contract-version-label').textContent =
    baseV3 ? 'V3' : 'V2';

  $('v3-launch-mode').disabled =
    state.busy || !baseV3;

  const activeWallet =
    state.wallet?.toLowerCase();

  const creatorWallet =
    Boolean(activeWallet) &&
    activeWallet ===
      String(state.market?.creator || '').toLowerCase();

  const controllerWallet =
    Boolean(activeWallet) &&
    activeWallet ===
      String(state.market?.mayhemController || '').toLowerCase();

  $('v3-request-manual').disabled =
    !writable() ||
    !creatorWallet ||
    state.market?.contractVersion !== 3 ||
    state.market?.launchMode !== 2 ||
    state.market?.pendingManualRequest === true;

  $('v3-support-submit').disabled =
    !writable() ||
    !controllerWallet ||
    state.market?.contractVersion !== 3;

  $('v3-finalize-mayhem').disabled =
    !writable() ||
    state.market?.contractVersion !== 3 ||
    state.market?.mayhemState !== 3 ||
    state.market?.mayhemFinalized === true;
  $('create-supply-fact').textContent = baseModern ? 'Custom' : '1 billion';
  $('create-supply-mode-fact').textContent = baseModern ? 'Supply options' : 'Fixed supply';
  $('create-supply-help').textContent =
    baseModern
      ? 'No creator allocation. Choose Fixed / No Mint or a permanently capped Mintable supply.'
      : 'No creator allocation. All supply starts in the market vault. No future minting.';

  if (
    state.chain === 'solana' &&
    state.config?.solana?.protocol === 'tiny'
  ) {
    $('create-supply-fact').textContent =
      '1 billion';

    $('create-supply-mode-fact').textContent =
      'Creator mint locked';

    $('create-supply-help').textContent =
      'Maximum supply: 1 billion coins - creator minting is locked - coins are distributed through the PumpLite curve - virtual reserve: 30 SOL - trading fee: 0.25%.';
  }

  $('v2-supply-mode').disabled =
    state.busy || !baseModern;
  $('v2-initial-supply').disabled = state.busy || !baseModern;
  $('v2-initial-mayhem').disabled = state.busy || !baseModern;

  $('v2-max-supply').disabled =
    state.busy ||
    !baseModern ||
    $('v2-supply-mode').value !== 'mintable';

  $('base-v2-buy-burn-submit').disabled =
    !writable() || ![2, 3].includes(state.market?.contractVersion);

  $('v2-mint-submit').disabled =
    !writable() ||
    !creatorWallet ||
    ![2, 3].includes(state.market?.contractVersion) ||
    state.market?.mintingLocked === true ||
    state.market?.mintableAtLaunch !== true;

  $('v2-lock-minting').disabled =
    !writable() ||
    !creatorWallet ||
    ![2, 3].includes(state.market?.contractVersion) ||
    state.market?.mintingLocked === true ||
    state.market?.mintableAtLaunch !== true;

  const mayhemReady =
    [2, 3].includes(state.market?.contractVersion) &&
    mayhemManualReady(state.market);

  $('v2-mayhem-on').disabled =
    !writable() ||
    !baseV2 ||
    !controllerWallet ||
    !mayhemReady ||
    state.market?.mayhemActive === true;

  $('v2-mayhem-off').disabled =
    !writable() ||
    !baseV2 ||
    !controllerWallet ||
    !mayhemReady ||
    state.market?.mayhemActive !== true;

  $('v2-support-submit').disabled =
    !writable() ||
    !controllerWallet ||
    ![2, 3].includes(state.market?.contractVersion);

  const ownerReviewReady =
    writable() &&
    state.chain === 'base' &&
    [2, 3].includes(state.market?.contractVersion) &&
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
    !metadataEnabled
      ? 'Metadata publishing is currently disabled.'
      : !$('metadata-image').files?.length
        ? 'Choose a PNG, JPEG or WebP token image, then tap Publish.'
        : !state.wallet
          ? state.chain === 'solana'
            ? 'Connect Phantom first. Metadata authorization does not spend SOL.'
            : 'Tap Publish to connect your Base wallet. Metadata authorization does not spend ETH.'
          : 'Ready to publish. Metadata authorization does not spend ' +
            (state.chain === 'solana' ? 'SOL.' : 'ETH.');
  $('chain').disabled = state.busy; $('connect').disabled = state.busy;
  $('create').disabled =
    state.busy ||
    (
      state.chain === 'solana'
        ? !writable()
        : !transactionConfigEnabled(
            state.config,
            state.chain
          )
    );
  $('trade').disabled = !writable() || !state.quote;
  $('create-action-status').textContent =
    state.chain !== 'base' || !transactionConfigEnabled(state.config, state.chain)
      ? 'Token creation is not enabled on this network.'
      : state.wallet
        ? 'Wallet connected: ' + state.wallet.slice(0, 6) + '…' + state.wallet.slice(-4) + '. Create coin will open the optional first-buy step.'
        : 'Create coin is ready. If needed, tapping it will request access to your Base wallet first.';
  if (state.chain === 'solana') {
    $('create-action-status').textContent =
      !transactionConfigEnabled(
        state.config,
        'solana'
      )
        ? 'PumpLite Solana Mainnet transactions are currently disabled.'
        : state.wallet
          ? ($('solana-mayhem')?.value === 'manual' ? 'Phantom connected. Manual creation registers the launch and requires an activation buy.' : 'Phantom connected. Create coin will write the mint and metadata to Solana Mainnet immediately.')
          : 'Connect Phantom first, then create your PumpLite Solana coin on-chain.';

    $('creation-review').textContent = $('solana-mayhem')?.value === 'manual' ? 'Manual Mayhem: sign the launch and mint authorization, then approve the real activation buy in Phantom. Network/account costs apply.' :
      'PumpLite creation fee is 0 SOL. Phantom reviews one Solana Mainnet creation transaction; one-time Solana network/account costs apply. The mint and metadata are created immediately, no buyer is required, and there is no later PumpLite bill.';
  }

  $('get-quote').disabled =
    !ready() ||
    !state.market ||
    state.busy;
  $('refresh').disabled = !ready() || state.busy; $('refresh-market').disabled = !ready() || state.busy;
  $('home-refresh-live').disabled = !ready() || state.busy;
  $('more').disabled = state.busy; $('verified-only').disabled = state.busy;
  $('show-home').disabled=state.busy; $('show-create').disabled=state.busy; $('show-explore').disabled=state.busy; $('show-help').disabled=state.busy;
  for (const id of ['description','image-uri','banner-uri','website','twitter','telegram','discord','name','symbol','uri','side','amount','slippage','market-address','market-filter','market-sort','initial-buy-eth','initial-buy-currency','trade-display-amount','trade-display-currency','v3-support-amount']) $(id).disabled = state.busy;

  if (
    state.chain === 'solana'
  ) {
    const manualSolana =
      $('solana-mayhem')?.value ===
        'manual';

    if (!manualSolana) {
      $('initial-buy-eth').value =
        '0';
    }

    $('initial-buy-eth').disabled =
      state.busy ||
      !manualSolana;
  }
  $('trade-use-display').disabled =
    state.busy ||
    !simpleBuySupported();
  $('initial-buy-submit').disabled = state.busy;
  $('initial-buy-close').disabled = state.busy;
}
function invalidateQuote() {
  $('solana-rent-panel').hidden=true; $('solana-rent-consent').checked=false;
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
let chartTrades = [];
let chartMarketId = null;
let chartRange = 'LIVE';

const CHART_RANGES = Object.freeze({
  LIVE: null,
  '1D': 86_400,
  '1W': 604_800,
  '1M': 2_592_000,
  '1Y': 31_536_000,
  ALL: null
});

function chartPriceText(value, symbol) {
  if (!Number.isFinite(value) || value <= 0) return '-';

  const text =
    value >= 1
      ? value.toLocaleString(undefined, { maximumFractionDigits: 8 })
      : value >= 0.000001
        ? value.toPrecision(7)
        : value.toExponential(5);

  return text + ' ETH/' + symbol;
}

function setChartRangeButtons() {
  for (const button of document.querySelectorAll('[data-chart-range]')) {
    const active = button.dataset.chartRange === chartRange;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function tradesForChartRange() {
  if (chartRange === 'LIVE') {
    // LIVE means the latest available real trades, up to 30 executions.
    return chartTrades.slice(-30);
  }

  if (chartRange === 'ALL') {
    return [...chartTrades];
  }

  const seconds = CHART_RANGES[chartRange];
  const cutoff = Math.floor(Date.now() / 1000) - seconds;

  return chartTrades.filter(trade =>
    Number.isFinite(Number(trade.timestamp)) &&
    Number(trade.timestamp) >= cutoff
  );
}

function clearMarketChart(message, unit = 'ETH', symbol = 'TOKEN') {
  $('price-chart').replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'price-chart-empty';
  empty.textContent = message;
  $('price-chart').append(empty);

  $('price-chart-current').textContent = '-';
  $('price-chart-pair').textContent = unit + ' / ' + symbol;
  $('price-chart-change').textContent = 'No trades yet';
  $('price-chart-change').className = 'chart-change';
  $('price-chart-high').textContent = '-';
  $('price-chart-low').textContent = '-';
  $('price-chart-trades').textContent = '0';
  $('price-chart-status').textContent = message;
  clearRecentTrades(message);
}

function clearRecentTrades(message) {
  const root = $('recent-trades-list');
  if (!root) return;

  root.replaceChildren();

  const empty = document.createElement('p');
  empty.className = 'fine';
  empty.textContent = message;
  root.append(empty);
}

function renderRecentTrades(market) {
  const root = $('recent-trades-list');
  if (!root) return;

  root.replaceChildren();

  const recent =
    chartTrades
      .slice(-5)
      .reverse();

  if (!recent.length) {
    clearRecentTrades(
      'No completed PumpLite buy/sell trades were found in the loaded on-chain history.'
    );
    return;
  }

  for (const trade of recent) {
    const link = document.createElement('a');
    link.className = 'recent-trade-row';
    link.href =
      state.config[state.chain].explorer +
      '/tx/' +
      trade.transactionHash;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const side = document.createElement('strong');
    side.textContent =
      trade.isBuy ? 'Buy' : 'Sell';

    const amount = document.createElement('span');
    amount.textContent =
      trade.isBuy
        ? formatUnits(
            trade.input,
            market.nativeDecimals,
            6
          ) + ' ' + market.unit
        : formatUnits(
            trade.input,
            market.decimals,
            2
          ) + ' ' + market.symbol;

    const price = document.createElement('span');
    price.textContent =
      formatUnits(
        trade.price,
        market.nativeDecimals,
        14
      ) +
      ' ETH / ' +
      market.symbol;

    const time = document.createElement('small');
    time.textContent =
      Number.isFinite(Number(trade.timestamp))
        ? new Date(
            Number(trade.timestamp) * 1000
          ).toLocaleString()
        : 'Base block ' + trade.blockNumber;

    link.append(side, amount, price, time);
    root.append(link);
  }
}

let pliteDexStatsRequest = 0;

async function loadPliteDexStats(market) {
  const request = ++pliteDexStatsRequest;

  const isPlite =
    state.chain === 'base' &&
    String(market?.id || '').toLowerCase() ===
      PLITE_MARKET_ID;

  if (!isPlite) {
    $('plite-dex-liquidity').hidden = true;
    return;
  }

  $('plite-dex-liquidity').hidden = false;

  const fields = [
    'plite-dex-weth-reserve',
    'plite-dex-token-reserve',
    'plite-dex-price',
    'plite-dex-liquidity-value',
    'plite-dex-block'
  ];

  const production =
    location.protocol === 'https:' &&
    location.hostname !== 'localhost' &&
    location.hostname !== '127.0.0.1';

  if (!production) {
    for (const id of fields) {
      $(id).textContent = 'Production live read';
    }

    $('plite-dex-live-status').textContent =
      'Live PLITE/WETH reserves are read from Base Mainnet on the production HTTPS site.';

    return;
  }

  for (const id of fields) {
    $(id).textContent = 'Loading...';
  }

  $('plite-dex-live-status').textContent =
    'Reading the PLITE/WETH Uniswap V2 pair directly from Base Mainnet...';

  try {
    const stats =
      await (
        await getAdapter()
      ).pliteUniswapV2Stats(
        PLITE_UNISWAP_V2_PAIR_ADDRESS,
        market.token,
        BASE_WETH_ADDRESS
      );

    if (
      request !== pliteDexStatsRequest ||
      state.market?.id !== market.id
    ) {
      return;
    }

    $('plite-dex-weth-reserve').textContent =
      formatUnits(
        stats.wethReserve,
        18,
        8
      ) + ' WETH';

    $('plite-dex-token-reserve').textContent =
      formatUnits(
        stats.tokenReserve,
        18,
        2
      ) + ' PLITE';

    $('plite-dex-price').textContent =
      formatUnits(
        stats.priceWeiPerToken,
        18,
        14
      ) + ' WETH / PLITE';

    $('plite-dex-liquidity-value').textContent =
      formatUnits(
        stats.spotLiquidityWei,
        18,
        8
      ) + ' ETH equivalent';

    $('plite-dex-block').textContent =
      Number(
        stats.blockNumber
      ).toLocaleString();

    $('plite-dex-live-status').textContent =
      'Live reserves read directly from the verified Uniswap V2 pair at Base block ' +
      Number(stats.blockNumber).toLocaleString() +
      '. Spot-implied liquidity values the PLITE side at the pool reserve ratio; it is not a USD oracle or PumpLite curve liquidity.';
  } catch (error) {
    if (
      request !== pliteDexStatsRequest ||
      state.market?.id !== market.id
    ) {
      return;
    }

    for (const id of fields) {
      $(id).textContent = 'Unavailable';
    }

    $('plite-dex-live-status').textContent =
      'Live Uniswap V2 data is temporarily unavailable: ' +
      (error?.message || 'read failed');
  }
}

let marketStats24hRequest = 0;

async function loadMarket24hStats(market) {
  const request = ++marketStats24hRequest;

  if (state.chain === 'solana') {
    $('volume-24h').textContent = 'Loading…';
    $('trades-24h').textContent = 'Loading…';
    $('market-24h-status').textContent = 'Scanning recent confirmed PumpLite transactions on Solana Mainnet…';

    try {
      const adapter = await getAdapter();
      if (typeof adapter.marketStats24h !== 'function') throw Error('Solana trade scan unavailable');
      const stats = await adapter.marketStats24h(market);
      if (request !== marketStats24hRequest || state.market?.id !== market.id) return;
      $('volume-24h').textContent = compactAmount(stats.volume, market.nativeDecimals, 8) + ' SOL';
      $('trades-24h').textContent = Number(stats.trades).toLocaleString();
      $('market-24h-status').textContent = stats.coverageComplete
        ? 'Rolling 24h PumpLite trade window covered by the confirmed Solana scan · ' + Number(stats.scannedSignatures).toLocaleString() + ' mint transaction(s) checked.'
        : 'Bounded recent Solana scan · ' + Number(stats.scannedSignatures).toLocaleString() + ' mint transaction(s) checked. 24h totals may undercount if older transactions are outside this scan.';
    } catch (error) {
      if (request !== marketStats24hRequest || state.market?.id !== market.id) return;
      $('volume-24h').textContent = 'Unavailable';
      $('trades-24h').textContent = 'Unavailable';
      $('market-24h-status').textContent = 'Solana trade history is temporarily unavailable: ' + (error?.message || 'read failed');
    }
    return;
  }

  const production =
    location.protocol === 'https:' &&
    location.hostname !== 'localhost' &&
    location.hostname !== '127.0.0.1';

  if (!production) {
    $('volume-24h').textContent =
      'Production live read';

    $('trades-24h').textContent =
      'Production live read';

    $('market-24h-status').textContent =
      'Rolling 24h statistics are read from Base Mainnet on the production HTTPS site.';

    return;
  }

  $('volume-24h').textContent = 'Loading…';
  $('trades-24h').textContent = 'Loading…';

  $('market-24h-status').textContent =
    'Reading the exact rolling 24h PumpLite curve window from Base Mainnet…';

  try {
    const stats =
      await (await getAdapter()).marketStats24h(
        market
      );

    if (
      request !== marketStats24hRequest ||
      state.market?.id !== market.id
    ) {
      return;
    }

    $('volume-24h').textContent =
      compactAmount(
        stats.volume,
        market.nativeDecimals,
        8
      ) +
      ' ' +
      market.unit;

    $('trades-24h').textContent =
      Number(stats.trades).toLocaleString();

    $('market-24h-status').textContent =
      'Rolling 24h curve activity through Base block ' +
      Number(stats.toBlock).toLocaleString() +
      '. Volume follows the deployed PumpLite market accounting; the trade count contains real Buy/Sell Trade events only.' +
      (stats.buyAndBurns
        ? ' ' +
          Number(stats.buyAndBurns).toLocaleString() +
          ' Buy & Burn execution(s) are included in curve volume but not the trade count.'
        : '');
  } catch (error) {
    if (
      request !== marketStats24hRequest ||
      state.market?.id !== market.id
    ) {
      return;
    }

    $('volume-24h').textContent = 'Unavailable';
    $('trades-24h').textContent = 'Unavailable';

    $('market-24h-status').textContent =
      '24h Base activity is temporarily unavailable: ' +
      (error?.message || 'read failed');
  }
}

function renderMarketChartRange(market) {
  setChartRangeButtons();

  $('price-chart-pair').textContent =
    market.unit + ' / ' + market.symbol;

  const visible = tradesForChartRange();

  const summary = renderPriceChart(
    $('price-chart'),
    visible,
    market.symbol
  );

  if (!summary.count) {
    const spotPrice =
      marketPriceWei(market);

    $('price-chart-current').textContent =
      spotPrice === null
        ? '-'
        : marketPriceText(market);

    $('price-chart-high').textContent = '-';
    $('price-chart-low').textContent = '-';
    $('price-chart-trades').textContent = '0';

    if (!chartTrades.length) {
      $('price-chart-change').textContent =
        'No trades yet';

      $('price-chart-status').textContent =
        spotPrice === null
          ? 'No completed PumpLite trades were found in the loaded on-chain history.'
          : 'No completed PumpLite trades were found in the loaded on-chain history. The value above is the current on-chain bonding-curve spot price, not an invented trade price.';
    } else {
      $('price-chart-change').textContent =
        'No trades';
      $('price-chart-status').textContent =
        'No timestamped real trades were found in the selected ' +
        chartRange +
        ' range. Try LIVE or ALL.';
    }

    $('price-chart-change').className =
      'chart-change';
    return;
  }

  const change = summary.changePct;
  const direction = summary.direction;

  $('price-chart-current').textContent =
    chartPriceText(summary.latestPrice, market.symbol);

  $('price-chart-high').textContent =
    chartPriceText(summary.highPrice, market.symbol);

  $('price-chart-low').textContent =
    chartPriceText(summary.lowPrice, market.symbol);

  $('price-chart-trades').textContent =
    String(summary.count);

  $('price-chart-change').className =
    'chart-change' +
    (direction === 'up'
      ? ' up'
      : direction === 'down'
        ? ' down'
        : '');

  $('price-chart-change').textContent =
    (change > 0 ? '+' : '') +
    change.toFixed(2) +
    '%';

  const rangeDescription =
    chartRange === 'LIVE'
      ? 'latest available real trades'
      : chartRange === 'ALL'
        ? 'all trades in the loaded bounded history'
        : chartRange + ' real trades';

  $('price-chart-status').textContent =
    summary.count +
    ' ' +
    rangeDescription +
    ' - latest execution ' +
    chartPriceText(summary.latestPrice, market.symbol) +
    '. The line is ' +
    (direction === 'up'
      ? 'green because the range ended higher.'
      : direction === 'down'
        ? 'red because the range ended lower.'
        : 'neutral because the first and last displayed prices match.');
}

async function loadMarketChart(market) {
  const request = ++chartRequest;

  if (chartMarketId !== market.id) {
    chartMarketId = market.id;
    chartTrades = [];
    chartRange = 'LIVE';
    setChartRangeButtons();
  }

  const adapter = await getAdapter();
  const chartSupported =
    state.chain === 'solana'
      ? typeof adapter.tradeHistory === 'function'
      : [2, 3].includes(market.contractVersion) && typeof adapter.tradeHistory === 'function';

  if (!chartSupported) {
    clearMarketChart(
      'Trade history is not available for this PumpLite market yet.',
      market.unit,
      market.symbol
    );
    return;
  }

  $('price-chart-status').textContent =
    'Loading recent confirmed PumpLite trades from ' + state.config[state.chain].name + '...';

  clearRecentTrades(
    'Loading recent confirmed PumpLite trades...'
  );

  try {
    const trades =
      await adapter.tradeHistory(
        market,
        state.chain === 'solana' ? 80 : 120
      );

    if (
      request !== chartRequest ||
      state.market?.id !== market.id
    ) {
      return;
    }

    chartTrades = trades;
    renderRecentTrades(market);
    renderMarketChartRange(market);
  } catch (error) {
    if (
      request !== chartRequest ||
      state.market?.id !== market.id
    ) {
      return;
    }

    chartTrades = [];

    clearMarketChart(
      'Recent trade history is temporarily unavailable: ' +
      (error?.message || 'read failed')
    );
  }
}

for (const button of document.querySelectorAll('[data-chart-range]')) {
  button.addEventListener('click', () => {
    const selected = button.dataset.chartRange;
    if (!Object.hasOwn(CHART_RANGES, selected)) return;

    chartRange = selected;

    if (state.market) {
      renderMarketChartRange(state.market);
    } else {
      setChartRangeButtons();
    }
  });
}
async function getAdapter() {
  if (state.adapter) return state.adapter;
  const chain = state.chain, epoch = state.epoch;
  if (chain === 'solana') { diagnostic('Loading Solana SDK…'); status('Loading Solana wallet support…'); }
  let module;

  if (chain === 'solana') {
    /*
     * PumpLite production Solana support is intentionally
     * restricted to the reviewed tiny adapter.
     *
     * Legacy Pump/PumpSwap compatibility is retired so its
     * unused SDK dependency graph cannot enter the release.
     */
    if (
      state.config?.solana?.protocol !==
        'tiny'
    ) {
      throw Error(
        'Unsupported Solana protocol configuration'
      );
    }

    module =
      await import(
        './adapters/solana-tiny.js'
      );
  } else {
    module =
      state.config?.base?.contractVersion === 3
        ? await import('./adapters/base-v3.js')
        : state.config?.base?.contractVersion === 2
          ? await import('./adapters/base-v2.js')
          : await import('./adapters/base.js');
  }
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
function marketPriceWei(m) {
  if (!m) return null;

  if (
    typeof m.tokenReserve !== 'bigint' ||
    m.tokenReserve <= 0n
  ) return null;

  return (
    (m.virtualNative + m.nativeReserve) *
    10n ** BigInt(m.decimals)
  ) / m.tokenReserve;
}

function marketPriceText(m) {
  const value = marketPriceWei(m);
  if (value === null) return 'Unavailable';
  return formatUnits(value, m.nativeDecimals, 14) + ' ' + m.unit;
}

function marketCapWei(m) {
  if(m.protocol==='tiny') return m.tokenReserve>0n ? (m.nativeReserve+m.virtualNative)*m.circulating/m.tokenReserve : null;
  const price = marketPriceWei(m);

  if (
    price === null ||
    typeof m?.supply !== 'bigint' ||
    m.supply < 0n
  ) {
    return null;
  }

  return (
    price *
    (m.protocol === 'tiny' ? m.circulating : m.supply) /
    (10n ** BigInt(m.decimals))
  );
}

function marketCapText(m) {
  const value = marketCapWei(m);

  if (value === null) {
    return 'Unavailable';
  }

  return (
    compactAmount(
      value,
      m.nativeDecimals,
      8
    ) +
    ' ' +
    m.unit
  );
}

function distributedPercent(m) {
  if (!m?.supply || m.supply <= 0n) return 0;

  const custody =
    m.tokenReserve +
    (m.agentInventory || 0n);

  const distributed =
    m.supply > custody
      ? m.supply - custody
      : 0n;

  return Number(
    distributed *
    10_000n /
    m.supply
  ) / 100;
}

function launchAge(m) {
  const launched = Number(m?.launchedAt);
  if (!Number.isFinite(launched) || launched <= 0) return 'Unknown';

  const seconds = Math.max(
    0,
    Math.floor(Date.now() / 1000) - launched
  );

  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86_400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86_400) + 'd';
}

function compactAmount(value, decimals, places = 4) {
  const number = Number(formatUnits(value, decimals, places));
  if (!Number.isFinite(number)) return formatUnits(value, decimals, places);
  if (number >= 1_000_000_000) return (number / 1_000_000_000).toFixed(2).replace(/\.00$/, '') + 'B';
  if (number >= 1_000_000) return (number / 1_000_000).toFixed(2).replace(/\.00$/, '') + 'M';
  if (number >= 1_000) return (number / 1_000).toFixed(2).replace(/\.00$/, '') + 'K';
  return formatUnits(value, decimals, places);
}

function avatarTone(m) {
  const text = String(m?.symbol || m?.name || 'PL');
  let total = 0;
  for (const char of text) total += char.charCodeAt(0);
  return total % 5;
}

async function hydrateTokenAvatar(node, m) {
  if (!node || !m) return;
  const fallback = String(m.symbol || 'PL').slice(0, 2).toUpperCase();
  node.replaceChildren();
  node.textContent = fallback;

  const media = await loadTokenMedia(m.uri);
  if (!media?.image || state.market?.id && node.id === 'market-token-avatar' && state.market.id !== m.id) return;

  const image = document.createElement('img');
  image.src = media.image;
  image.alt = m.name + ' token image';
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => {
    node.replaceChildren();
    node.textContent = fallback;
  }, { once: true });
  node.replaceChildren(image);
}

let marketSummaryRequest = 0;
async function loadMarketTokenSummary(m) {
  const request = ++marketSummaryRequest;
  const avatar = $('market-token-avatar');
  avatar.textContent = String(m.symbol || 'PL').slice(0, 2).toUpperCase();
  void hydrateTokenAvatar(avatar, m);

  const price = marketPriceWei(m);
  const cap = marketCapWei(m);

  $('market-hero-price').textContent = marketPriceText(m) + ' / ' + m.symbol;
  $('market-hero-cap').textContent = marketCapText(m);
  $('market-hero-backing').textContent = compactAmount(m.nativeReserve, m.nativeDecimals, 8) + ' ' + m.unit;
  $('market-hero-progress').value = Math.max(0, Math.min(100, distributedPercent(m)));
  $('market-hero-progress-label').textContent = distributedPercent(m).toFixed(2) + '% distributed on the PumpLite curve';
  $('market-summary-address').textContent = m.token;

  $('market-hero-holders').textContent = state.chain === 'solana' ? 'Loading…' : 'Not indexed';
  $('market-hero-holders-note').textContent = state.chain === 'solana' ? 'Direct positive-balance owner scan' : 'Reliable holder indexing is not enabled on this network.';

  try {
    const rates = await loadInitialBuyRates(m.unit);
    if (request !== marketSummaryRequest || state.market?.id !== m.id) return;
    const nativePrice = price === null ? NaN : Number(formatUnits(price, m.nativeDecimals, 12));
    const nativeCap = cap === null ? NaN : Number(formatUnits(cap, m.nativeDecimals, 8));
    const nzd = Number(rates.NZD);
    const usd = Number(rates.USD);
    $('market-hero-price-fiat').textContent =
      Number.isFinite(nativePrice) && Number.isFinite(nzd) && Number.isFinite(usd)
        ? '≈ ' + formatInitialBuyFiat(nativePrice * nzd, 'NZD') + ' / ' + formatInitialBuyFiat(nativePrice * usd, 'USD')
        : 'Fiat estimate unavailable';
    $('market-hero-cap-fiat').textContent =
      Number.isFinite(nativeCap) && Number.isFinite(nzd) && Number.isFinite(usd)
        ? '≈ ' + formatInitialBuyFiat(nativeCap * nzd, 'NZD') + ' / ' + formatInitialBuyFiat(nativeCap * usd, 'USD')
        : 'Fiat estimate unavailable';
  } catch {
    if (request === marketSummaryRequest && state.market?.id === m.id) {
      $('market-hero-price-fiat').textContent = 'Fiat estimate unavailable';
      $('market-hero-cap-fiat').textContent = 'Fiat estimate unavailable';
    }
  }

  if (state.chain === 'solana') {
    try {
      const adapter = await getAdapter();
      if (typeof adapter.holderStats !== 'function') throw Error('Holder scan unavailable');
      const stats = await adapter.holderStats(m);
      if (request !== marketSummaryRequest || state.market?.id !== m.id) return;
      $('market-hero-holders').textContent = Number(stats.holders).toLocaleString();
      $('market-hero-holders-note').textContent =
        Number(stats.positiveAccounts).toLocaleString() +
        ' positive-balance token account' +
        (stats.positiveAccounts === 1 ? '' : 's') +
        ' · direct Solana read';
    } catch {
      if (request === marketSummaryRequest && state.market?.id === m.id) {
        $('market-hero-holders').textContent = 'Unavailable';
        $('market-hero-holders-note').textContent = 'Holder scan exceeded the live RPC limit or is temporarily unavailable.';
      }
    }
  }
}

function row(m) {
  const link = document.createElement('a');
  link.className = 'market-row token-market-card';
  link.href = '#' + state.chain + '/' + encodeURIComponent(m.id);

  const head = document.createElement('div');
  head.className = 'token-card-head';

  const avatar = document.createElement('span');
  avatar.className = 'token-avatar tone-' + avatarTone(m);
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = String(m.symbol || 'PL').slice(0, 2).toUpperCase();
  void hydrateTokenAvatar(avatar, m);

  const identity = document.createElement('span');
  identity.className = 'token-card-identity';

  const title = document.createElement('b');
  title.textContent = m.name;

  const ticker = document.createElement('span');
  ticker.className = 'ticker';
  ticker.textContent = m.symbol + ' / ' + m.unit;

  identity.append(title, ticker);

  const age = document.createElement('span');
  age.className = 'token-age';
  age.textContent = launchAge(m);

  head.append(avatar, identity, age);

  const chips = document.createElement('div');
  chips.className = 'token-card-chips';
  chips.append(
    badges(
      state.chain,
      state.config?.[state.chain],
      m,
      state.registry
    )
  );

  if (m.mayhemActive === true) {
    const mayhem = document.createElement('span');
    mayhem.className = 'badge mayhem';
    mayhem.textContent = 'Mayhem';
    chips.append(mayhem);
  }

  const metrics = document.createElement('div');
  metrics.className = 'token-card-metrics';

  const entries = [
    ['Price', marketPriceText(m)],
    ['Curve cap', marketCapText(m)],
    ['Curve volume', m.protocol === 'tiny' ? 'Not available yet' : compactAmount(m.volume, m.nativeDecimals, 6) + ' ' + m.unit],
    ['Curve backing', compactAmount(m.nativeReserve, m.nativeDecimals, 6) + ' ' + m.unit],
    ['Distributed', distributedPercent(m).toFixed(2) + '%']
  ];

  for (const [label, value] of entries) {
    const item = document.createElement('span');
    const small = document.createElement('small');
    const strong = document.createElement('strong');
    small.textContent = label;
    strong.textContent = value;
    item.append(small, strong);
    metrics.append(item);
  }

  const curveProgress = document.createElement('div');
  curveProgress.className = 'token-card-progress';
  const curveProgressLabel = document.createElement('span');
  curveProgressLabel.textContent = 'Bonding curve ' + distributedPercent(m).toFixed(2) + '%';
  const curveProgressBar = document.createElement('progress');
  curveProgressBar.max = 100;
  curveProgressBar.value = Math.max(0, Math.min(100, distributedPercent(m)));
  curveProgress.append(curveProgressLabel, curveProgressBar);

  const footer = document.createElement('small');
  footer.className = 'token-card-source';
  footer.textContent =
    'On-chain market ' +
    m.id.slice(0, 6) +
    '...' +
    m.id.slice(-4) + (m.protocol === 'tiny' ? ' · ' + formatUnits(m.actualSupply, m.decimals, 2) + ' minted / ' + formatUnits(m.maximumSupply, m.decimals, 0) + ' maximum' : '');

  link.append(head, chips, metrics, curveProgress, footer);
  return link;
}
async function refreshRegistry() {
  state.registry=null;
  try { state.registry=await loadReviewedRegistry(); $('verification-list-status').textContent='Verified is an owner identity/provenance review, not a safety or investment endorsement.'; }
  catch { $('verification-list-status').textContent='Reviewed list unavailable. Verified badges are hidden; factory provenance is separate.'; }
}
function renderPlatformStats() {
  const loaded =
    state.markets;

  const totalReserve =
    loaded.reduce(
      (sum, m) =>
        sum +
        m.nativeReserve,
      0n
    );

  const totalVolume =
    loaded.reduce(
      (sum, m) =>
        sum +
        m.volume,
      0n
    );

  const nativeDecimals =
    loaded[0]?.nativeDecimals ??
    (
      state.chain === 'solana'
        ? 9
        : 18
    );

  const nativeUnit =
    loaded[0]?.unit ||
    (
      state.chain === 'solana'
        ? 'SOL'
        : 'ETH'
    );

  const marketCount =
    Number(
      state.platformStats?.marketCount ??
      loaded.length
    );

  $('platform-market-count').textContent =
    Number.isFinite(
      marketCount
    )
      ? String(
          marketCount
        )
      : '-';

  $('platform-loaded-reserve').textContent =
    compactAmount(
      totalReserve,
      nativeDecimals,
      6
    ) +
    ' ' +
    nativeUnit;

  $('platform-loaded-volume').textContent =
    compactAmount(
      totalVolume,
      nativeDecimals,
      6
    ) +
    ' ' +
    nativeUnit;

  if (state.chain === 'solana') $('platform-loaded-volume').textContent = 'Not available yet';

  const complete =
    Number.isFinite(
      marketCount
    ) &&
    marketCount ===
      loaded.length;

  $('platform-reserve-label').textContent =
    complete
      ? 'All markets'
      : 'Loaded markets';

  $('platform-volume-label').textContent =
    complete
      ? 'Total volume'
      : 'Loaded volume';

  $('platform-block').textContent =
    state.platformStats?.blockNumber
      ? Number(
          state.platformStats.blockNumber
        ).toLocaleString()
      : '-';

  $('platform-last-refresh').textContent =
    loaded.length
      ? 'Updated ' +
        new Date()
          .toLocaleTimeString()
      : 'Waiting for chain read';
}

function renderFeaturedPlite() {
  const market =
    state.featuredPlite ||
    state.markets.find(
      value =>
        String(value.id).toLowerCase() ===
        PLITE_MARKET_ID
    );

  const fields = [
    'plite-featured-price',
    'plite-featured-market-cap',
    'plite-featured-reserve',
    'plite-featured-supply',
    'plite-featured-volume'
  ];

  if (
    state.chain !== 'base' ||
    !market
  ) {
    for (const id of fields) {
      const node = $(id);
      if (node) node.textContent = '-';
    }

    const note = $('plite-featured-status');
    if (note) {
      note.textContent =
        'Waiting for the live PLITE Base market read.';
    }
    return;
  }

  $('plite-featured-price').textContent =
    marketPriceText(market);

  $('plite-featured-market-cap').textContent =
    marketCapText(market);

  $('plite-featured-reserve').textContent =
    compactAmount(
      market.nativeReserve,
      market.nativeDecimals,
      6
    ) + ' ETH';

  $('plite-featured-supply').textContent =
    compactAmount(
      market.supply,
      market.decimals,
      2
    ) + ' PLITE';

  $('plite-featured-volume').textContent =
    compactAmount(
      market.volume,
      market.nativeDecimals,
      6
    ) + ' ETH';

  $('plite-featured-status').textContent =
    'Live bonding-curve data from ' +
    market.source +
    '. PLITE also has a separate Uniswap V2 PLITE/WETH pool. DEX liquidity is not counted as curve backing.';
}

function marketSortValue(m, mode) {
  if (mode === 'market-cap') return marketCapWei(m) ?? 0n;
  if (mode === 'volume') return m.volume;
  if (mode === 'reserve') return m.nativeReserve;
  if (mode === 'distributed') {
    return BigInt(Math.round(distributedPercent(m) * 100));
  }
  return BigInt(Number(m.launchedAt || 0));
}

function visibleMarkets() {
  const query =
    $('market-filter').value.trim().toLowerCase();

  const verifiedOnly =
    $('verified-only').checked;

  const mode = $('market-sort').value;

  return state.markets
    .filter(m => {
      if (
        verifiedOnly &&
        !tokenTrust(
          state.chain,
          state.config[state.chain],
          m,
          state.registry
        ).verified
      ) return false;

      if (!query) return true;

      return [
        m.name,
        m.symbol,
        m.id,
        m.token
      ].some(value =>
        String(value).toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      const left = marketSortValue(a, mode);
      const right = marketSortValue(b, mode);
      return left === right ? 0 : left > right ? -1 : 1;
    });
}

function renderHomeMarkets() {
  const root = $('home-markets');
  root.replaceChildren();

  const networkName =
    state.config?.[state.chain]?.name ||
    (state.chain === 'solana'
      ? 'Solana Mainnet'
      : 'Base Mainnet');

  const newest = [...state.markets]
    .sort((a, b) =>
      Number(b.launchedAt || 0) -
      Number(a.launchedAt || 0)
    )
    .slice(0, 4);

  for (const market of newest) {
    const card = row(market);
    // Home duplicates must not use .market-row because that selector is
    // reserved for the active Markets & Trade results and browser tests.
    card.classList.remove('market-row');
    card.classList.add('home-market-card');
    root.append(card);
  }

  if (!newest.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent =
      ready()
        ? 'No markets returned yet. Tap Refresh live to try again.'
        : networkName + ' deployment is not configured.';
    root.append(empty);
  }

  $('home-live-status').textContent =
    newest.length
      ? 'Showing real ' +
        networkName +
        ' market data. Auto-refresh runs while this HTTPS page is open.'
      : 'No invented activity is displayed.';
}

async function renderPendingSolanaLaunches() {
  const existing =
    document.getElementById(
      'solana-pending-launch-section'
    );

  if (
    state.chain !==
      'solana'
  ) {
    existing?.remove();
    return;
  }

  const module =
    await import(
      './solana-launch-ui.js'
    );

  module.renderPendingLaunches({
    anchor:
      $('markets'),
    launches:
      state.pendingLaunches,
    adapter:
      state.adapter,
    wallet:
      state.wallet,
    treasury:
      state.config?.solana?.treasury,
    transactionsEnabled:
      transactionConfigEnabled(
        state.config,
        'solana'
      ),
    refresh:
      () => discover(false),
    run:
      action,
    status
  });
}

function renderDiscovery() {
  void renderPendingSolanaLaunches();
  $('markets').replaceChildren();

  const visible = visibleMarkets();

  for (const market of visible) {
    $('markets').append(row(market));
  }

  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent =
      $('verified-only').checked
        ? 'No verified markets match the current search.'
        : state.markets.length
          ? 'No loaded markets match your search.'
          : state.chain === 'solana'
            ? 'No activated Solana markets yet. Free pending launches appear above.'
            : 'No markets loaded. Refresh live to read the Base factory.';
    $('markets').append(empty);
  }

  renderHomeMarkets();
  renderPlatformStats();
  renderFeaturedPlite();

  $('market-live-status').replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'live-dot';
  dot.setAttribute('aria-hidden', 'true');
  $('market-live-status').append(
    dot,
    document.createTextNode(
      state.markets.length
        ? ' Updated ' + new Date().toLocaleTimeString()
        : state.chain === 'solana'
          ? ' Waiting for Solana market data'
          : ' Waiting for Base market data'
    )
  );
}
async function discover(append = false) {
  requireDeployment();
  if (!append) state.markets = [];

  // Remove old labels before any fresh read; failures cannot leave a stale Verified badge.
  state.registry = null;
  renderDiscovery();

  const adapter = await getAdapter();
  const result =
    await adapter.list(append ? state.next : 0);

  if (
    state.chain ===
      'solana' &&
    typeof adapter
      .pendingLaunches ===
      'function'
  ) {
    const pending =
      await adapter
        .pendingLaunches(0);

    state.pendingLaunches =
      pending.launches;
  } else {
    state.pendingLaunches =
      [];
  }

  try {
    state.platformStats =
      typeof adapter.platformStats === 'function'
        ? await adapter.platformStats()
        : null;
  } catch {
    state.platformStats = null;
  }

  await refreshRegistry();

  state.markets = append
    ? [...state.markets, ...result.markets]
    : result.markets;

  const listedPlite =
    state.markets.find(
      market =>
        String(market.id).toLowerCase() ===
        PLITE_MARKET_ID
    );

  if (listedPlite) {
    state.featuredPlite = listedPlite;
  } else if (
    !append ||
    !state.featuredPlite
  ) {
    try {
      state.featuredPlite =
        await adapter.market(
          PLITE_MARKET_ADDRESS
        );
    } catch {
      state.featuredPlite = null;
    }
  }

  state.next = result.next;
  $('more').hidden = result.next === null;

  renderDiscovery();

  status(
    'Read ' +
    result.markets.length +
    ' markets from ' +
    state.config[state.chain].name +
    '. Live values come from the chain.'
  );
}

async function refreshLiveData() {
  requireDeployment();

  if (!state.markets.length) {
    await discover(false);
    return;
  }

  const adapter = await getAdapter();

  const refreshedMarkets = [];

  // Keep public-RPC reads bounded instead of refreshing every market at once.
  for (const market of state.markets) {
    refreshedMarkets.push(
      await adapter.market(market.id)
    );
  }

  state.markets = refreshedMarkets;

  const listedPlite =
    state.markets.find(
      market =>
        String(market.id).toLowerCase() ===
        PLITE_MARKET_ID
    );

  if (listedPlite) {
    state.featuredPlite = listedPlite;
  } else {
    try {
      state.featuredPlite =
        await adapter.market(
          PLITE_MARKET_ADDRESS
        );
    } catch {
      state.featuredPlite = null;
    }
  }

  try {
    state.platformStats =
      typeof adapter.platformStats === 'function'
        ? await adapter.platformStats()
        : state.platformStats;
  } catch {
    // Keep the most recent valid platform count/block read.
  }

  if (state.market) {
    const fresh =
      await adapter.market(state.market.id);
    state.market = fresh;
    renderMarket(fresh);
    void loadMarket24hStats(fresh);
    void loadPliteDexStats(fresh);
  }

  renderDiscovery();
}
function renderMarket(m) {
  void renderSolanaFiat();
  verificationPanel(state.chain,state.config[state.chain],m,state.registry);
  renderTokenDetailCard(m);
  $('market-summary-name').textContent = m.name + ' (' + m.symbol + ')';
  $('market-summary-network').textContent = state.config[state.chain].name;
  void loadMarketTokenSummary(m);
  $('market-metadata').textContent = m.uri ? 'Creator metadata URI (not fetched or verified): ' + m.uri : 'No creator metadata URI supplied.';
  $('market-name').textContent = m.name; $('market-symbol').textContent = m.symbol + ' / ' + m.unit;
  $('market-source').textContent = m.source + ' · fetched ' + new Date(m.observedAt).toLocaleTimeString() + ' · refresh on demand';
  $('curve-price').textContent = marketPriceText(m) + ' / ' + m.symbol;
  $('market-cap').textContent = marketCapText(m) + (m.protocol === 'tiny' ? ' · implied curve value of supply outside vault; not cash liquidity' : '');
  $('native-reserve').textContent = formatUnits(m.nativeReserve, m.nativeDecimals) + ' ' + m.unit;
  $('token-reserve').textContent = formatUnits(m.tokenReserve, m.decimals, 2) + ' ' + m.symbol;
  $('volume').textContent = m.protocol === 'tiny' ? 'Not available yet (indexed history required)' : formatUnits(m.volume, m.nativeDecimals) + ' ' + m.unit;
  $('volume-24h').textContent = 'Loading…';
  $('trades-24h').textContent = 'Loading…';
  $('market-24h-status').textContent =
    state.chain === 'solana'
      ? 'Preparing PumpLite Solana market status...'
      : 'Preparing the rolling 24h Base activity read...';
  $('virtual').textContent = formatUnits(m.virtualNative, m.nativeDecimals) + ' ' + m.unit;
  $('market-age').textContent = launchAge(m);
  $('market-block').textContent = Number(m.provenance?.block || 0).toLocaleString();
  const marketCustody =
    m.tokenReserve +
    (m.agentInventory || 0n);

  const distributed =
    Number(
      (m.supply - marketCustody) *
      10_000n /
      m.supply
    ) / 100;
  $('distribution').value = distributed;
  $('distribution-label').textContent =
    m.protocol === 'tiny' ? formatUnits(m.actualSupply, m.decimals, 6) + ' currently minted · ' + formatUnits(m.circulating, m.decimals, 6) + ' outside market vault · ' + formatUnits(m.maximumSupply, m.decimals, 0) + ' maximum curve supply. ' + (m.mode === 'legacy' ? 'Remaining curve allocation is not minted yet.' : 'Remaining tokens are held in the market vault.') : distributed.toFixed(2) + '% distributed from the current token supply.';

  const isPlite =
    state.chain === 'base' &&
    String(m.id).toLowerCase() === PLITE_MARKET_ID;

  $('plite-dex-liquidity').hidden = !isPlite;

  if (isPlite) {
    $('plite-dex-pair-address').textContent =
      PLITE_UNISWAP_V2_PAIR_ADDRESS;

    for (const id of [
      'plite-dex-weth-reserve',
      'plite-dex-token-reserve',
      'plite-dex-price',
      'plite-dex-liquidity-value',
      'plite-dex-block'
    ]) {
      $(id).textContent = 'Loading...';
    }

    $('plite-dex-live-status').textContent =
      'Preparing the live Uniswap V2 reserve read...';
  }

  const baseV2 = m.contractVersion === 2;
  const baseV3 = m.contractVersion === 3;
  const baseModern = baseV2 || baseV3;

  $('base-v2-market').hidden = !baseModern;
  $('base-v2-burn-form').hidden = !baseModern;
  $('base-v3-agent-status').hidden = !baseV3;

  if (baseModern) {
    $('v2-supply-status').textContent =
      (m.mintableAtLaunch ? 'Mintable' : 'Fixed / No Mint') +
      ' · current ' +
      formatUnits(m.supply, 18, 2) +
      ' · max ' +
      formatUnits(m.maxSupply, 18, 2) +
      (m.mintingLocked ? ' · minting locked' : '');

    if (baseV3) {
      const modeNames = [
        'CLASSIC',
        'MAYHEM AUTO',
        'MAYHEM MANUAL'
      ];

      const stateNames = [
        'CLASSIC',
        'ACTIVE',
        'PAUSED',
        'ENDED'
      ];

      $('v2-mayhem-status').textContent =
        modeNames[m.launchMode] || 'UNKNOWN';

      $('v3-market-mode').textContent =
        modeNames[m.launchMode] || 'Unknown';

      $('v3-agent-state').textContent =
        stateNames[m.mayhemState] || 'Unknown';

      $('v3-agent-trades').textContent =
        Number(m.mayhemTradeCount || 0n).toLocaleString();

      $('v3-agent-inventory').textContent =
        formatUnits(
          m.agentInventory || 0n,
          m.decimals,
          2
        ) +
        ' ' +
        m.symbol;

      $('v3-agent-volume').textContent =
        formatUnits(
          m.agentVolume || 0n,
          m.nativeDecimals
        ) +
        ' ' +
        m.unit;

      $('v3-agent-ends').textContent =
        m.launchMode === 0
          ? 'Not applicable'
          : new Date(
              Number(m.mayhemEndsAt) * 1000
            ).toLocaleString();

      $('v3-manual-status').textContent =
        m.launchMode !== 2
          ? 'This market is not Manual Mayhem.'
          : m.pendingManualRequest
            ? 'One creator-requested agent trade is pending.'
            : 'No manual agent trade is pending.';

      $('base-v3-manual-tools').hidden =
        m.launchMode !== 2;

      $('v3-finalize-mayhem').hidden =
        m.launchMode === 0 ||
        m.mayhemState !== 3 ||
        m.mayhemFinalized === true;

      $('v2-mayhem-help').textContent =
        'V3 launch mode is immutable. Agent activity is labeled separately from organic user trades.';
    } else {
      $('v2-mayhem-status').textContent =
        m.mayhemActive ? 'ACTIVE' : 'OFF';

      $('v2-mayhem-help').textContent =
        mayhemHelp(m);

      $('base-v3-manual-tools').hidden = true;
      $('v3-finalize-mayhem').hidden = true;
    }

    $('v2-support-total').textContent =
      formatUnits(m.totalMarketSupport, 18) + ' ETH';

    $('v2-burned-total').textContent =
      formatUnits(m.totalBurned, 18, 2) + ' ' + m.symbol;

    const walletAddress = state.wallet?.toLowerCase();

    const isCreator =
      Boolean(walletAddress) &&
      walletAddress ===
        String(m.creator).toLowerCase();

    const isController =
      Boolean(walletAddress) &&
      walletAddress ===
        String(m.mayhemController).toLowerCase();

    $('base-v2-creator').hidden = !isCreator;
    $('base-v2-controller').hidden =
      !isController || !baseV2;
    $('base-v3-controller').hidden =
      !isController || !baseV3;
    $('market-admin-tools').hidden =
      !isCreator && !isController;
  } else {
    $('base-v2-creator').hidden = true;
    $('base-v2-controller').hidden = true;
    $('base-v3-controller').hidden = true;
    $('base-v3-manual-tools').hidden = true;
    $('v3-finalize-mayhem').hidden = true;
    $('market-admin-tools').hidden = true;
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
  $('market-link').href =
    c.explorer +
    (
      state.chain === 'solana'
        ? '/account/' +
          (m.marketAddress || m.id)
        : '/address/' + m.id
    );
  $('token-link').href = c.explorer + '/token/' + m.token;
  $('amount-label').textContent = $('side').value === 'buy' ? 'Amount (' + m.unit + ')' : 'Amount (' + m.symbol + ')';
  $('trade-quick-buy-title').textContent = 'Buy ' + m.symbol + ' simply';
  $('trade-use-display').textContent = 'Buy ' + m.symbol;
  if (!$('trade-display-amount').value.trim()) {
    $('simple-buy-output').textContent = '- ' + m.symbol;
  } else {
    queueMicrotask(() => void updateTradeBuyEstimate());
  }

  syncTradeHelperMode();
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
    if (m.protocol === 'tiny') {
      const percent = total => total > 0n ? (Number(balances.tokens * 1000000n / total) / 10000).toFixed(4) + '%' : 'Not available yet';
      $('balance').textContent += ' · ' + percent(m.actualSupply) + ' of currently minted supply · ' + percent(m.maximumSupply) + ' of maximum curve supply';
      const price = marketPriceWei(m);
      if (price !== null) $('balance').textContent += ' · implied curve value ' + formatUnits(price * balances.tokens / (10n ** BigInt(m.decimals)), m.nativeDecimals, 9) + ' SOL (not a liquidation quote)';
    }
  }

  void loadMarketChart(m);
  void loadMarket24hStats(m);
  void loadPliteDexStats(m);
  void loadOwnerReviewTools(m).catch(error => {
    $('eas-schema-status').textContent =
      'Portable review tools are temporarily unavailable: ' +
      (error?.message || 'read failed');
  });
}
async function route() {
  chartRequest++;
  pliteDexStatsRequest++;
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
    for (const field of ['market-source','market-metadata','market-cap','native-reserve','token-reserve','volume','volume-24h','trades-24h','market-24h-status','virtual','distribution-label']) $(field).textContent = '—';
    $('distribution').value = 0;
    $('plite-dex-liquidity').hidden = true;
    $('market-link').removeAttribute('href'); $('token-link').removeAttribute('href');
    await loadMarket(id);
  }
}
function switchChain(chain) {
  state.adapter?.disconnect();

  $('create-trading-fee').textContent =
    '0.25%';

  $('create-trading-fee-label').textContent =
    'Trading fee';
  state.chain = chain; state.epoch++; state.adapter = null; state.wallet = null; state.market = null; state.next = null; state.markets=[]; state.pendingLaunches=[]; state.featuredPlite=null; state.registry=null; state.platformStats=null;
  syncTradeHelperMode();
  $('create-network').textContent =
    chain === 'base'
      ? 'Base Mainnet · ETH pair'
      : 'Solana Mainnet · SOL pair';
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
  $('more').hidden = true;
  invalidateQuote();
  renderDiscovery();
  controls();
  status(state.config[chain].name + ' selected. Wallet disconnected.');
}
$('chain').addEventListener('change', () => {
  const chain =
    $('chain').value;

  switchChain(chain);

  location.hash = '';
  $('home').hidden = false;
  $('market-page').hidden = true;

  if (
    chain === 'solana' &&
    ready()
  ) {
    // Load code only. No wallet permission, signature or RPC
    // transaction is requested by this preload.
    void getAdapter().catch(error => {
      status(
        'PumpLite Solana Mainnet wallet support could not load: ' +
        (
          error?.message ||
          'unknown browser error'
        )
      );
    });
  }
});
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

  if (
    state.market ||
    location.hash.startsWith('#base/')
  ) {
    $('balance').textContent =
      'Wallet connected. Loading Base market and token balances…';
  }

  return address;
}

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
    routeParts[0] === state.chain &&
    routeParts[1]
      ? decodeURIComponent(
          routeParts[1]
        )
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

const HOME_PAGE_TARGETS = Object.freeze({
  home: 'home-overview',
  create: 'create-section',
  markets: 'explore-section',
  help: 'help-section'
});

function showHomePage(page, { focus = true } = {}) {
  const selected = Object.hasOwn(HOME_PAGE_TARGETS, page) ? page : 'home';

  $('home-overview').hidden = selected !== 'home';
  $('home-workspace').hidden = !['create', 'markets'].includes(selected);
  $('create-section').hidden = selected !== 'create';
  $('explore-section').hidden = selected !== 'markets';
  $('help-section').hidden = selected !== 'help';

  for (const [id, name] of [
    ['show-home', 'home'],
    ['show-create', 'create'],
    ['show-explore', 'markets'],
    ['show-help', 'help']
  ]) {
    $(id).setAttribute('aria-pressed', String(selected === name));
  }

  if (focus) {
    const target = $(HOME_PAGE_TARGETS[selected]);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

$('show-home').addEventListener('click', () => showHomePage('home'));
$('show-create').addEventListener('click', () => showHomePage('create'));
$('show-explore').addEventListener('click', () => showHomePage('markets'));
$('show-help').addEventListener('click', () => showHomePage('help'));
$('hero-explore').addEventListener('click', () => showHomePage('markets'));
$('hero-create').addEventListener('click', () => showHomePage('create'));

const requestedHomePage =
  new URL(location.href).searchParams.get('page');

showHomePage(
  Object.hasOwn(
    HOME_PAGE_TARGETS,
    requestedHomePage
  )
    ? requestedHomePage
    : 'home',
  { focus: false }
);
$('verified-only').addEventListener('change',()=>action(async()=>{state.registry=null;renderDiscovery();await refreshRegistry();renderDiscovery();}));
$('market-filter').addEventListener('input', renderDiscovery);
$('market-sort').addEventListener('change', renderDiscovery);

$('refresh').addEventListener('click', () => action(() => discover()));
$('home-refresh-live').addEventListener('click', () => action(() => refreshLiveData()));
$('more').addEventListener('click', () => action(() => discover(true)));
$('refresh-market').addEventListener('click', () => action(() => loadMarket(state.market?.id || decodeURIComponent(location.hash.split('/')[1]))));
$('open-form').addEventListener('submit', e => { e.preventDefault(); if (!state.busy) location.hash = state.chain + '/' + encodeURIComponent($('market-address').value.trim()); });
function creationData() {
  const data = {
    name: $('name').value.trim(),
    symbol: $('symbol').value.trim(),
    uri: $('uri').value.trim()
  };

  if (state.chain === 'solana') {
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

    data.mayhemMode = $('solana-mayhem')?.value === 'manual' ? 'manual' : false;

    return data;
  }

  const creationVersion =
    Number(state.config?.base?.contractVersion || 0);

  if (
    state.chain !== 'base' ||
    ![2, 3].includes(creationVersion)
  ) {
    throw Error('Token creation is currently available on reviewed Base V2/V3 deployments only');
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
  if (creationVersion === 3) {
    data.launchMode =
      Number($('v3-launch-mode').value);

    if (
      !Number.isInteger(data.launchMode) ||
      data.launchMode < 0 ||
      data.launchMode > 2
    ) {
      throw Error('Choose Classic, Mayhem Auto or Mayhem Manual');
    }

    data.initialMayhem =
      data.launchMode !== 0;
  } else {
    data.initialMayhem =
      $('v2-initial-mayhem').checked;
  }

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
  const symbol =
    $('symbol').value.trim() ||
    'TOKEN';

  const solana =
    state.chain ===
    'solana';

  const manualSolana =
    solana &&
    $('solana-mayhem')?.value ===
      'manual';

  const title =
    $('initial-buy-title');

  const token =
    document.createElement(
      'span'
    );

  token.id =
    'initial-buy-symbol';

  token.textContent =
    symbol;

  title.replaceChildren();

  if (solana) {
    title.append(
      'Create ',
      token,
      ' on Solana?'
    );
  } else {
    title.append(
      'How much ',
      token,
      ' do you want to buy?'
    );
  }

  const dialog =
    $('initial-buy-dialog');

  const eyebrow =
    dialog.querySelector(
      '.eyebrow'
    );

  if (eyebrow) {
    eyebrow.textContent =
      solana
        ? 'IMMEDIATE ON-CHAIN CREATE'
        : 'OPTIONAL FIRST BUY';
  }

  const amountBox =
    dialog.querySelector(
      '.initial-buy-amount'
    );

  const fiatRow =
    dialog.querySelector(
      '.initial-buy-fiat-row'
    );

  if (amountBox) {
    amountBox.hidden =
      solana &&
      !manualSolana;
  }

  if (fiatRow) {
    fiatRow.hidden =
      solana &&
      !manualSolana;
  }

  const unit =
    amountBox?.querySelector(
      'strong'
    );

  if (unit) {
    unit.textContent =
      solana
        ? 'SOL'
        : 'ETH';
  }

  const label =
    dialog.querySelector(
      'label[for="initial-buy-eth"]'
    );

  if (label) {
    label.textContent =
      manualSolana
        ? 'First activation buy amount in SOL'
        : solana
          ? 'Solana network/account cost'
          : 'Optional first buy amount in ETH';
  }

  const feeCopy = dialog.querySelector('.create-fee-note small');
  if (feeCopy) feeCopy.textContent = manualSolana
    ? 'Manual Mayhem registers an immutable signed launch, reserves its mint, then requires a Phantom-approved activation buy. Message signatures cost no SOL; the real transaction has network/account costs.'
    : solana ? 'Normal Solana creation writes the mint and metadata immediately. No buyer activation is required. Network/account costs apply.'
    : 'Base creation and any optional first buy require wallet approval and Base network gas.';
  const intro =
    dialog.querySelector(
      'p.muted'
    );

  if (intro) {
    intro.textContent =
      manualSolana
        ? 'Manual Mayhem needs a first activation buy so the PumpLite market exists on-chain. Enter the SOL amount you want your connected wallet to buy during activation. PumpLite still charges a 0 SOL creation fee; Solana network/account costs also apply.'
        : solana
          ? 'PumpLite charges a 0 SOL creation fee. Phantom will review one Solana Mainnet transaction for the one-time network/account costs. The mint and metadata go on-chain immediately, even with zero buyers. There is no subscription or later PumpLite bill.'
          : 'Use 0 ETH to create only. Enter more than 0 ETH if you also want your connected wallet to buy the new token immediately after creation.';
  }
}

let initialBuyRates = null;
let initialBuyRatesAt = 0;
let initialBuyRatesNative = null;
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

async function loadInitialBuyRates(native) {
  if (native === 'SOL') return (await import('./solana-fiat.js')).loadSolRates();
  if (
    initialBuyRates &&
    initialBuyRatesNative === native &&
    Date.now() - initialBuyRatesAt < 60_000
  ) {
    return initialBuyRates;
  }

  const response = await fetch(
    'https://api.coinbase.com/v2/exchange-rates?currency=' +
      encodeURIComponent(native),
    {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    }
  );

  if (!response.ok) {
    throw Error(
      'Live fiat estimate unavailable'
    );
  }

  const value = await response.json();

  const nzd =
    Number(value?.data?.rates?.NZD);

  const usd =
    Number(value?.data?.rates?.USD);

  if (
    !Number.isFinite(nzd) ||
    !Number.isFinite(usd) ||
    nzd <= 0 ||
    usd <= 0
  ) {
    throw Error(
      'Live fiat estimate unavailable'
    );
  }

  initialBuyRates = {
    NZD: nzd,
    USD: usd
  };

  initialBuyRatesNative = native;
  initialBuyRatesAt = Date.now();

  return initialBuyRates;
}

async function updateInitialBuyEstimate() {
  const sequence =
    ++initialBuyEstimateSequence;

  const text =
    $('initial-buy-eth')
      .value
      .trim() || '0';

  const amount =
    Number(text);

  const currency =
    $('initial-buy-currency')
      .value;

  const output =
    $('initial-buy-fiat-estimate');

  const native =
    state.chain === 'solana'
      ? 'SOL'
      : 'ETH';

  if (
    state.chain === 'solana'
  ) {
    const manualSolana =
      $('solana-mayhem')?.value ===
        'manual';

    if (!manualSolana) {
      $('initial-buy-eth').value =
        '0';

      $('initial-buy-eth').disabled =
        true;

      $('initial-buy-submit')
        .textContent =
        'Create on Solana';

      output.textContent =
        'PumpLite fee: 0 SOL · one-time Solana network/account costs apply · no subscription or later PumpLite bill.';

      return;
    }

    $('initial-buy-eth').disabled =
      false;

    $('initial-buy-submit')
      .textContent =
      'Create Manual Mayhem coin';

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      output.textContent =
        'Enter a first activation buy. 0.001 SOL is the recommended starting amount; PumpLite checks the live Solana rent floor again before Phantom can sign.';

      return;
    }

    try {
      const rates =
        await loadInitialBuyRates(
          'SOL'
        );

      if (
        sequence !==
        initialBuyEstimateSequence
      ) {
        return;
      }

      const rate =
        Number(
          rates[currency]
        );

      output.textContent =
        amount +
        ' SOL first activation buy' +
        (
          Number.isFinite(rate) &&
          rate > 0
            ? ' · approximately ' +
              formatInitialBuyFiat(
                amount * rate,
                currency
              )
            : ''
        ) +
        ' · Solana network/account costs also apply.';
    } catch {
      output.textContent =
        amount +
        ' SOL first activation buy · Solana network/account costs also apply.';
    }

    return;
  }

  $('initial-buy-submit').textContent =
    Number.isFinite(amount) &&
    amount > 0
      ? 'Create coin + buy'
      : 'Create coin only';

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    output.textContent =
      'Enter a valid ' +
      native +
      ' amount.';
    return;
  }

  if (amount === 0) {
    output.textContent =
      '0 ' +
      native +
      ' · creation only. Network fees still apply.';
    return;
  }

  output.textContent =
    'Loading approximate ' +
    currency +
    ' value…';

  try {
    const rates =
      await loadInitialBuyRates(native);

    if (
      sequence !==
      initialBuyEstimateSequence
    ) {
      return;
    }

    output.textContent =
      text +
      ' ' +
      native +
      ' ≈ ' +
      formatInitialBuyFiat(
        amount * rates[currency],
        currency
      ) +
      ' (approximate). The wallet transaction is still in ' +
      native +
      '.';
  } catch {
    if (
      sequence !==
      initialBuyEstimateSequence
    ) {
      return;
    }

    output.textContent =
      'Fiat estimate is temporarily unavailable. The ' +
      native +
      ' amount is unchanged.';
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

function tradeNative() {
  return state.chain ===
    'solana'
      ? 'SOL'
      : 'ETH';
}

function simpleBuySupported() {
  if (!state.market) {
    return false;
  }

  if (
    state.chain ===
    'solana'
  ) {
    return (
      state.config?.solana?.protocol ===
        'tiny' &&
      state.market?.protocol ===
        'tiny'
    );
  }

  return (
    state.chain ===
      'base' &&
    [2, 3].includes(
      state.market
        ?.contractVersion
    )
  );
}

function syncTradeHelperMode() {

  void renderSolanaFiat();
  const symbol =
    state.market?.symbol ||
    'tokens';

  const native =
    tradeNative();

  const supported =
    simpleBuySupported();

  $('trade-quick-buy').hidden =
    !supported;

  $('trade-use-display').textContent =
    'Buy ' +
    symbol;

  $('trade-use-display').disabled =
    state.busy ||
    !supported;

  $('trade-quick-buy-copy').textContent =
    state.chain === 'solana'
      ? 'Buy with SOL, NZD or USD.'
      : 'Enter NZD or USD. PumpLite refreshes the live Base ETH quote before wallet approval.';

  $('simple-buy-note').textContent =
    state.chain === 'solana'
      ? 'Final payment is SOL. Phantom shows the transaction and network fee. PumpLite uses 1% slippage protection.'
      : 'Final payment is Base ETH. Your wallet shows the transaction and network fee. PumpLite uses 1% slippage protection.';

  $('trade-minimum-note').textContent =
    'Enter tokens to sell. The live quote shows expected ' +
    native +
    ' before wallet approval.';

  $('quote-output-label').textContent =
    'Expected ' +
    (
      state.chain === 'base'
        ? 'Base ETH'
        : 'SOL'
    );

  $('quote-min-label').textContent =
    'Minimum ' +
    (
      state.chain === 'base'
        ? 'Base ETH'
        : 'SOL'
    );
}

function normalizeTradeNative(
  value,
  decimals,
  unit
) {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw Error(
      'Enter an amount greater than 0'
    );
  }

  const text =
    value
      .toFixed(decimals)
      .replace(/0+$/, '')
      .replace(/\.$/, '');

  if (
    !text ||
    text === '0'
  ) {
    throw Error(
      'Amount is too small to convert to ' +
      unit
    );
  }

  return text;
}

function formatTradeDisplay(
  value,
  currency
) {
  if(currency==='SOL'&&state.chain==='solana')return value+' SOL';
  return formatInitialBuyFiat(
    value,
    currency
  );
}

function formatSimpleTokenAmount(
  value,
  decimals = 18
) {
  const text =
    formatUnits(
      value,
      decimals,
      6
    );

  const number =
    Number(text);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return text;
  }

  return new Intl.NumberFormat(
    'en-NZ',
    {
      maximumFractionDigits:
        6
    }
  ).format(number);
}

async function tradeDisplayNativeAmount() {
  const text =
    $('trade-display-amount')
      .value
      .trim();

  const source =
    $('trade-display-currency')
      .value;

  const amount =
    Number(text);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw Error(
      'Enter a valid amount greater than 0'
    );
  }

  if(state.chain==='solana'&&source==='SOL'){parseUnits(text,9);return text;}
  if (
    !['NZD', 'USD']
      .includes(source)
  ) {
    throw Error(
      'Simple buy supports NZD or USD'
    );
  }

  const native =
    tradeNative();

  const rates =
    await loadInitialBuyRates(
      native
    );

  const rate =
    Number(
      rates[source]
    );

  if (
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    throw Error(
      'Live ' +
      source +
      ' to ' +
      native +
      ' estimate is temporarily unavailable'
    );
  }

  const decimals =
    state.market
      ?.nativeDecimals ??
    (
      state.chain ===
        'solana'
        ? 9
        : 18
    );

  return normalizeTradeNative(
    amount /
      rate,
    decimals,
    native
  );
}

async function simpleBuyQuote(
  market,
  amount
) {
  if (
    state.chain ===
    'solana'
  ) {
    return (
      await getAdapter()
    ).quote(
      market,
      'buy',
      amount
    );
  }

  return quoteBaseV2(
    market,
    'buy',
    amount
  );
}

async function updateTradeBuyEstimate() {
  const sequence =
    ++tradeDisplaySequence;

  syncTradeHelperMode();

  const output =
    $('trade-display-estimate');

  const tokenOutput =
    $('simple-buy-output');

  const text =
    $('trade-display-amount')
      .value
      .trim();

  const symbol =
    state.market?.symbol ||
    'TOKEN';

  if (!text) {
    tokenOutput.textContent =
      '- ' +
      symbol;

    output.textContent =
      'Enter an amount above to see the live estimate.';

    return;
  }

  if (
    !simpleBuySupported()
  ) {
    tokenOutput.textContent =
      '- ' +
      symbol;

    output.textContent =
      state.chain ===
        'solana'
        ? 'Open an activated PumpLite Solana market to buy.'
        : 'Open a Base V2/V3 market to use simple buy.';

    return;
  }

  const source =
    $('trade-display-currency')
      .value;

  const displayAmount =
    Number(text);

  if (
    !Number.isFinite(
      displayAmount
    ) ||
    displayAmount <= 0
  ) {
    tokenOutput.textContent =
      '- ' +
      symbol;

    output.textContent =
      'Enter a valid amount greater than 0.';

    return;
  }

  const native =
    tradeNative();

  output.textContent =
    'Calculating the current ' +
    source +
    ' / ' +
    native +
    ' on-chain estimate...';

  try {
    const nativeText =
      await tradeDisplayNativeAmount();

    if (
      sequence !==
      tradeDisplaySequence
    ) {
      return;
    }

    const amountRaw =
      parseUnits(
        nativeText,
        state.market.nativeDecimals
      );

    const q =
      await simpleBuyQuote(
        state.market,
        amountRaw
      );

    if (
      sequence !==
      tradeDisplaySequence
    ) {
      return;
    }

    tokenOutput.textContent =
      '~ ' +
      formatSimpleTokenAmount(
        q.output,
        state.market.decimals
      ) +
      ' ' +
      state.market.symbol;

    output.textContent =
      formatTradeDisplay(
        displayAmount,
        source
      ) +
      ' ~ ' +
      nativeText +
      ' ' +
      native +
      ' - current on-chain estimate.';

    $('simple-buy-note').textContent =
      (
        q.support > 0n
          ? 'Mayhem support is included in this estimate. '
          : ''
      ) +
      'PumpLite refreshes the market again when you tap Buy ' +
      state.market.symbol +
      '. Your wallet shows the real ' +
      native +
      ' amount and network fee before final approval. Simple buy uses 1% slippage protection.';
  } catch (error) {
    if (
      sequence !==
      tradeDisplaySequence
    ) {
      return;
    }

    tokenOutput.textContent =
      '- ' +
      symbol;

    output.textContent =
      error?.message ||
      'Live buy estimate is temporarily unavailable.';
  }
}

async function updateTradeSellDisplay(
  nativeOutput
) {
  if (
    $('side').value !==
    'sell'
  ) {
    return;
  }

  const currency =
    $('trade-display-currency')
      .value;

  const amount =
    Number(
      nativeOutput
    );

  if (
    !Number.isFinite(
      amount
    ) ||
    amount <= 0
  ) {
    return;
  }

  const native =
    tradeNative();

  try {
    const rates =
      await loadInitialBuyRates(
        native
      );

    const rate =
      Number(
        rates[currency]
      );

    if (
      !Number.isFinite(rate) ||
      rate <= 0
    ) {
      return;
    }

    status(
      'Sell quote: about ' +
      formatTradeDisplay(
        amount *
          rate,
        currency
      ) +
      ' from ' +
      normalizeTradeNative(
        amount,
        state.market
          ?.nativeDecimals ??
          (
            state.chain ===
              'solana'
              ? 9
              : 18
          ),
        native
      ) +
      ' ' +
      native +
      '. The real payout is ' +
      native +
      '.'
    );
  } catch {}
}

$('trade-display-amount')
  .addEventListener(
    'input',
    () =>
      void updateTradeBuyEstimate()
  );

$('trade-display-currency')
  .addEventListener(
    'change',
    () =>
      void updateTradeBuyEstimate()
  );

$('side').addEventListener(
  'change',
  () =>
    syncTradeHelperMode()
);

$('trade-use-display')
  .addEventListener(
    'click',
    () =>
      action(
        async () => {
          if (
            !simpleBuySupported()
          ) {
            throw Error(
              state.chain ===
                'solana'
                ? 'Open an activated PumpLite Solana market first'
                : 'Simple buy requires a Base V2/V3 market'
            );
          }

          const source =
            $('trade-display-currency')
              .value;

          const displayAmount =
            Number(
              $('trade-display-amount')
                .value
                .trim()
            );

          if (
            !Number.isFinite(
              displayAmount
            ) ||
            displayAmount <= 0
          ) {
            throw Error(
              'Enter a valid amount greater than 0'
            );
          }

          if (
            !state.wallet
          ) {
            if (
              state.chain ===
              'base'
            ) {
              await connectBaseWalletFromGesture();
            } else {
              throw Error(
                'Connect Phantom before buying on Solana'
              );
            }
          }

          requireWrite();

          const native =
            tradeNative();

          const active =
            await getAdapter();

          const fresh =
            await active.market(
              state.market.id
            );

          state.market =
            fresh;

          renderMarket(
            fresh
          );

          const nativeText =
            await tradeDisplayNativeAmount();

          const amountRaw =
            parseUnits(
              nativeText,
              fresh.nativeDecimals
            );

          const q =
            state.chain ===
              'solana'
              ? await active.quote(
                  fresh,
                  'buy',
                  amountRaw
                )
              : quoteBaseV2(
                  fresh,
                  'buy',
                  amountRaw
                );

          const min =
            minimumOutput(
              q.output,
              100
            );

          const expected =
            formatSimpleTokenAmount(
              q.output,
              fresh.decimals
            );

          $('simple-buy-output')
            .textContent =
            '~ ' +
            expected +
            ' ' +
            fresh.symbol;

          $('trade-display-estimate')
            .textContent =
            formatTradeDisplay(
              displayAmount,
              source
            ) +
            ' -> about ' +
            expected +
            ' ' +
            fresh.symbol +
            '. Opening your wallet for final ' +
            native +
            ' review.';

          status(
            'Review the wallet transaction: approximately ' +
            expected +
            ' ' +
            fresh.symbol +
            ' for ' +
            formatTradeDisplay(
              displayAmount,
              source
            ) +
            ' (' +
            nativeText +
            ' ' +
            native +
            '), plus the network fee.'
          );

          await active.trade(
            fresh,
            'buy',
            amountRaw,
            min,
            state.chain ===
              'solana'
              ? 1
              : undefined
          );

          await refreshMarketAfterAction(
            fresh.id
          );
        }
      )
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
        if (state.chain === 'base') {
          inline.textContent =
            'Requesting access to your Base wallet…';

          await connectBaseWalletFromGesture();
        } else {
          inline.textContent =
            'Connect your Solana wallet first.';

          throw Error(
            'Connect your Solana wallet first'
          );
        }
      }

      requireWrite();

      updateInitialBuySymbol();
      $('initial-buy-eth').value =
        state.chain === 'solana' && $('solana-mayhem')?.value === 'manual'
          ? '0.001'
          : '0';
      $('initial-buy-currency').value = 'NZD';
      $('initial-buy-flow-status').textContent =
        'Nothing has been submitted yet.';
      void updateInitialBuyEstimate();

      inline.textContent =
        state.chain === 'solana'
          ? 'Wallet ready. PumpLite creation fee is 0 SOL. Phantom will review one Solana Mainnet transaction; one-time network/account costs apply.'
          : 'Wallet ready. Review the Base creation transaction before approving it.';

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
        if (state.chain === 'base') {
          inline.textContent =
            'Requesting access to your Base wallet…';

          await connectBaseWalletFromGesture();
        } else {
          inline.textContent =
            'Connect your Solana wallet first.';

          throw Error(
            'Connect your Solana wallet first'
          );
        }
      }

      requireWrite();

      const data = creationData();

      const initialBuyText =
        $('initial-buy-eth').value.trim() || '0';

      const initialBuy =
        /^(?:0+)(?:\.0+)?$/.test(initialBuyText)
          ? 0n
          : parseUnits(
          initialBuyText,
          state.chain === 'solana'
            ? 9
            : 18
        );

      if (initialBuy < 0n) {
        throw Error(
          'Optional first buy cannot be negative'
        );
      }

      const adapter = await getAdapter();

      const manualSolana =
        state.chain === 'solana' &&
        data.mayhemMode === 'manual';

      /*
       * Manual Mayhem must be chosen before the launch exists.
       * It therefore uses PumpLite's signed launch registry and
       * reserved first-buyer activation path.
       *
       * A positive first buy is required because that activation
       * creates the actual PumpLite market and gives Mayhem a
       * canonical on-chain market to trade against.
       */
      if (
        manualSolana &&
        initialBuy === 0n
      ) {
        throw Error(
          'Manual Mayhem requires a first activation buy large enough to keep the new market rent-exempt. 0.001 SOL is recommended; PumpLite verifies the live minimum before Phantom can sign.'
        );
      }

      if (
        state.chain === 'solana' &&
        !manualSolana &&
        initialBuy !== 0n
      ) {
        throw Error(
          'Normal Solana creation is create-only. Buy it later from its market page.'
        );
      }

      flow.textContent =
        manualSolana
          ? 'Manual Mayhem selected. First sign the immutable launch and Mayhem messages; message signatures spend no SOL. Phantom will then show the one real activation transaction.'
          : state.chain === 'solana'
            ? 'Review the Solana Mainnet creation transaction in Phantom. PumpLite charges no creation fee; one-time Solana network/account costs apply.'
            : 'Step 1: review token creation in your wallet. This dialog will stay here until the result is known.';

      inline.textContent =
        manualSolana
          ? 'Preparing the immutable Manual Mayhem launch. No transaction is sent until Phantom shows the final activation transaction.'
          : state.chain === 'solana'
            ? 'Creating the mint and metadata on Solana Mainnet now. No buyer is required and there is no later PumpLite bill.'
            : 'Review token creation in your wallet. PumpLite creation fee is 0%; Base gas still applies.';

      if (manualSolana) {
        const draft = await launchStage('Launch registration failed', () => adapter.createFreeDraft(data));

        flow.textContent =
          'Manual Mayhem choice recorded at creation. Preparing the creator first-buyer reservation.';

        const reservation = await launchStage('Reservation request failed', () => adapter.reserveFirstBuyer({launchId:draft.id}));

        if (
          reservation.launchId !==
          draft.id
        ) {
          throw Error(
            'Manual Mayhem reservation changed unexpectedly'
          );
        }

        const {
          authorizeReservedMint
        } =
          await import(
            './mayhem-ui.js'
          );

        flow.textContent =
          'Reservation ready. Sign the Manual Mayhem mint authorization message. This message signature spends no SOL.';

        await authorizeReservedMint(
          draft.id,
          state.wallet,
          message =>
            adapter
              .signMayhemMessage(
                message
              )
        );

        const quote =
          adapter
            .quoteFirstBuyerActivation(
              initialBuy
            );

        const minimum =
          minimumOutput(
            quote.output,
            100
          );

        flow.textContent =
          'Manual Mayhem is immutably authorized. Review the real Solana activation + first-buy transaction in Phantom.';

        const submitted =
          await launchStage('Activation not confirmed; do not resend blindly', () => adapter.activateReservedFirstBuyer({
              launchId:
                draft.id,
              buyAmount:
                initialBuy,
              buyMinimum:
                minimum
            }));

        flow.textContent =
          'Activation confirmed on Solana. Verifying it before enabling Manual Mayhem.';

        const finalized = await launchStage('Finalization pending', () => adapter.retryFinalizeFirstBuyer({launchId:draft.id}));

        if (
          finalized.mint !==
            submitted.mint ||
          finalized.market !==
            submitted.market
        ) {
          throw Error(
            'Finalized Manual Mayhem activation changed unexpectedly'
          );
        }

        createdId =
          submitted.mint;

        flow.textContent =
          'Manual Mayhem token created and canonical activation verified.';
      } else {
        createdId =
          await adapter.create(
            data
          );
      }

      if (
        initialBuy > 0n &&
        !manualSolana
      ) {
        flow.textContent =
          'Token created. Preparing your optional first buy with the same wallet…';

        inline.textContent =
          'Token created. Your same wallet will now show the optional buy confirmation.';

        const market =
          await adapter.market(createdId);

        const q =
          state.chain === 'solana'
            ? await adapter.quote(
                market,
                'buy',
                initialBuy
              )
            : [2, 3].includes(
                market.contractVersion
              )
              ? quoteBaseV2(
                  market,
                  'buy',
                  initialBuy
                )
              : quote(
                  market,
                  'buy',
                  initialBuy
                );

        const min =
          minimumOutput(
            q.output,
            100
          );

        flow.textContent =
          'Step 2: review the optional buy in your wallet.';

        await adapter.trade(
          market,
          'buy',
          initialBuy,
          min,
          state.chain === 'solana'
            ? 1
            : undefined
        );
      }

      inline.textContent =
        state.chain === 'solana'
          ? (manualSolana ? 'Manual Mayhem coin activated and verified on Solana Mainnet.' : 'Coin created on Solana Mainnet. No buyer was required.')
          : initialBuy > 0n
            ? 'Token created and optional first buy confirmed.'
            : 'Token created. No optional first buy was requested.';

      flow.textContent =
        state.chain === 'solana'
          ? 'Finished: mint and metadata are on-chain. PumpLite charged no creation fee.'
          : initialBuy > 0n
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
        '. A registered launch or submitted transaction may already exist. Retry continues the same signed launch; do not create a replacement. This dialog stays open.';

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
    state.chain === 'solana'
      ? await (await getAdapter())
          .quote(
            m,
            side,
            amount
          )
      : [2, 3].includes(
          m.contractVersion
        )
        ? quoteBaseV2(
            m,
            side,
            amount
          )
        : quote(
            m,
            side,
            amount
          );

  const min =
    minimumOutput(
      q.output,
      slippageBps
    );
  const decimals = side === 'buy' ? m.decimals : m.nativeDecimals, unit = side === 'buy' ? m.symbol : m.unit;
  state.quote = {
    ...q,
    min,
    amount,
    side,
    slippagePercent:
      slippageBps / 100,
    at: Date.now(),
    market: m.id,
    chain: state.chain
  };
  $('quote-output').textContent = formatUnits(q.output, decimals, decimals) + ' ' + unit;
  $('quote-min').textContent = formatUnits(min, decimals, decimals) + ' ' + unit;
  $('quote-fee').textContent =
    state.chain === 'solana'
      ? state.config?.solana?.protocol === 'tiny'
        ? formatUnits(
            q.fee,
            m.nativeDecimals,
            m.nativeDecimals
          ) + ' SOL · PumpLite 0.25% fee'
        : 'Pump protocol + creator fees are included in the on-chain quote'
      : formatUnits(
          q.fee,
          m.nativeDecimals,
          m.nativeDecimals
        ) + ' ' + m.unit;

  $('quote-support-row').hidden = m.contractVersion !== 2;

  $('quote-support').textContent =
    [2, 3].includes(m.contractVersion)
      ? formatUnits(q.support, m.nativeDecimals, m.nativeDecimals) + ' ' + m.unit
      : '—';
  if(state.chain==='solana'&&side==='sell'&&q.rentTopUp>0n){
    $('solana-rent-panel').hidden=false;
    $('solana-rent-consent').checked=false;
    $('solana-rent-details').textContent='Additional market rent deposit: '+formatUnits(q.rentTopUp,9,9)+' SOL. Expected proceeds after this deposit: '+formatUnits(q.output-q.rentTopUp,9,9)+' SOL; minimum after deposit: '+formatUnits(min-q.rentTopUp,9,9)+' SOL, before network fees. The exact deposit is rechecked before signing; market movement may change how much is needed. Preview again if it increases.';
    if(q.rentTopUp>=min){invalidateQuote();throw Error('Rent support would consume the minimum sale proceeds. Try a smaller partial sale.');}
  }
  void renderSolanaFiat();
  $('quote-age').textContent = 'Quoted at ' + new Date().toLocaleTimeString() + '. Valid for review for 30 seconds; chain slippage protection still applies.';

  if (side === 'sell') {
    void updateTradeSellDisplay(
      Number(formatUnits(q.output-(q.rentTopUp||0n), m.nativeDecimals, m.nativeDecimals))
    );
  }
}));
$('trade-form').addEventListener('submit', e => { e.preventDefault(); action(async () => {
  requireWrite();
  const q = state.quote;
  if (!q || Date.now() - q.at > 30_000 || q.market !== state.market?.id || q.chain !== state.chain) {
    invalidateQuote(); throw Error('Quote expired. Request a fresh quote.');
  }
  const rentConsent={accepted:$('solana-rent-consent').checked, maximum:q.rentTopUp||0n};
  if(state.chain==='solana'&&q.rentTopUp>0n&&!rentConsent.accepted)throw Error('Accept the disclosed rent support before reviewing this sale in Phantom.');
  invalidateQuote();
  await (await getAdapter()).trade(
    state.market,
    q.side,
    q.amount,
    q.min,
    q.slippagePercent,
    rentConsent
  );
  await refreshMarketAfterAction(state.market.id);
}); });
$('v2-supply-mode').addEventListener('change', controls);

$('v3-request-manual').addEventListener(
  'click',
  () => action(async () => {
    requireWrite();

    if (
      state.market?.contractVersion !== 3 ||
      state.market?.launchMode !== 2
    ) {
      throw Error(
        'This market is not V3 Mayhem Manual'
      );
    }

    await (await getAdapter())
      .requestManualMayhemTrade(
        state.market
      );

    await refreshMarketAfterAction(
      state.market.id
    );
  })
);

$('v3-finalize-mayhem').addEventListener(
  'click',
  () => action(async () => {
    requireWrite();

    if (
      state.market?.contractVersion !== 3 ||
      state.market?.mayhemState !== 3
    ) {
      throw Error(
        'Mayhem has not reached its immutable end condition'
      );
    }

    await (await getAdapter())
      .finalizeMayhem(
        state.market
      );

    await refreshMarketAfterAction(
      state.market.id
    );
  })
);

$('v3-support-form').addEventListener(
  'submit',
  e => {
    e.preventDefault();

    action(async () => {
      requireWrite();

      if (
        state.market?.contractVersion !== 3
      ) {
        throw Error(
          'V3 support requires a V3 market'
        );
      }

      const amount =
        parseUnits(
          $('v3-support-amount')
            .value
            .trim(),
          18
        );

      await (await getAdapter())
        .supportMarket(
          state.market,
          amount
        );

      await refreshMarketAfterAction(
        state.market.id
      );
    });
  }
);

$('v3-launch-mode').addEventListener(
  'change',
  () => {
    const mode =
      Number(
        $('v3-launch-mode').value
      );

    $('v3-launch-mode-help')
      .textContent =
        mode === 0
          ? 'Classic has no agent inventory or agent trades.'
          : mode === 1
            ? 'Mayhem Auto prepares a 24-hour randomized agent lane. Agent trades are labeled separately from organic volume.'
            : 'Mayhem Manual lets the creator request one randomized agent trade at a time. The creator cannot choose buy/sell direction or size.';
  }
);

$('base-v2-burn-form').addEventListener('submit', e => {
  e.preventDefault();

  action(async () => {
    requireWrite();

    if (![2, 3].includes(state.market?.contractVersion)) {
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
        './config.json?boot=20261005pumplite1&attempt=' + attempt,
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

  /*
   * Browser/UI readiness must not depend on parsing the
   * large Pump SDK chunk.
   */
  document.documentElement.dataset.walletAppReady =
    'ready';

  /*
   * Warm the reviewed Pump adapter after normal application
   * boot. This does not request wallet access, sign anything,
   * submit a transaction or spend SOL.
   */
  if (
    state.chain === 'solana' &&
    ready()
  ) {
    document.documentElement.dataset.pumpAdapterReady =
      'loading';

    queueMicrotask(() => {
      void getAdapter()
        .then(() => {
          document.documentElement.dataset.pumpAdapterReady =
            'ready';
        })
        .catch(error => {
          document.documentElement.dataset.pumpAdapterReady =
            'error';

          status(
            'PumpLite Solana Mainnet wallet support could not load: ' +
            (
              error?.message ||
              'unknown browser error'
            )
          );
        });
    });
  }

  // Production HTTPS pages begin read-only market discovery automatically.
  // Local tests use HTTP, so they remain deterministic and make no external calls.
  const productionLiveReads =
    location.protocol === 'https:' &&
    location.hostname !== 'localhost' &&
    location.hostname !== '127.0.0.1';

  if (productionLiveReads) {
    queueMicrotask(() => {
      if (!state.busy && state.chain === 'base') {
        void action(() => refreshLiveData());
      }
    });

    window.setInterval(() => {
      if (
        !document.hidden &&
        !state.busy &&
        state.chain === 'base'
      ) {
        void action(() => refreshLiveData());
      }
    }, 20_000);
  }
} catch (error) {
  $('deployment').textContent =
    'Base Mainnet configuration could not load. Trading remains disabled until this is fixed.';

  status(
    error.message ||
    'Unable to load public network configuration'
  );

  controls();
}


function renderSolanaFiat(){
 if(state.chain!=='solana'){$('solana-fiat-panel')?.setAttribute('hidden','');return;}
 return import('./solana-fiat-ui.js').then(m=>m.render(()=>state)).catch(()=>{});
}
