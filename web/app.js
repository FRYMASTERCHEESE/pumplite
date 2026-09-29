import { metadataExtras, LINK_FIELDS } from './metadata-fields.js';
import { tokenTrust } from './verification.js';
import { loadReviewedRegistry, badges, verificationPanel } from './verification-ui.js';
import { discoverEvm, solanaDiagnostics } from './wallets.js';
import { mobileBrowseLink } from './mobile.js';
import { metadataDocument } from './metadata.js';
import { parseUnits, formatUnits, quote, quoteBaseV2, minimumOutput, validateMetadata } from './math.js';
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

  $('v2-mayhem-on').disabled =
    !writable() || state.market?.contractVersion !== 2;

  $('v2-mayhem-off').disabled =
    !writable() || state.market?.contractVersion !== 2;

  $('v2-support-submit').disabled =
    !writable() || state.market?.contractVersion !== 2;
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
  for (const id of ['description','image-uri','banner-uri','website','twitter','telegram','discord','name','symbol','uri','side','amount','slippage','market-address','initial-buy-eth']) $(id).disabled = state.busy;
}
function invalidateQuote() {
  state.quote = null;
  for (const id of ['quote-output','quote-min','quote-fee','quote-support']) $(id).textContent = '—';
  $('quote-age').textContent = 'Get a current quote before signing.';
  controls();
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

  if (state.market) await loadMarket(state.market.id);
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
  $('initial-buy-dialog').close();

  action(async () => {
    const inline = $('create-action-status');

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
        parseUnits(initialBuyText, 18);

      if (initialBuy < 0n) {
        throw Error(
          'Optional first buy cannot be negative'
        );
      }

      const adapter = await getAdapter();

      inline.textContent =
        'Review token creation in your wallet. PumpLite creation fee is 0%; Base gas still applies.';

      const id = await adapter.create(data);

      // Always route to the created market, even when an optional
      // buy is later rejected by the user.
      location.hash =
        state.chain + '/' + encodeURIComponent(id);

      if (initialBuy > 0n) {
        inline.textContent =
          'Token created. Your same wallet will now show the optional buy confirmation.';

        const market =
          await adapter.market(id);

        const q =
          quoteBaseV2(
            market,
            'buy',
            initialBuy
          );

        const min =
          minimumOutput(q.output, 100);

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
    await loadMarket(fresh.id);
  });
});

$('v2-mint-form').addEventListener('submit', e => {
  e.preventDefault();

  action(async () => {
    requireWrite();

    const amount = parseUnits($('v2-mint-amount').value.trim(), 18);

    await state.adapter.mintInventory(state.market, amount);
    await loadMarket(state.market.id);
  });
});

$('v2-lock-minting').addEventListener('click', () => action(async () => {
  requireWrite();

  if (!window.confirm('Permanently disable all future minting? This cannot be undone.')) return;

  await state.adapter.lockMinting(state.market);
  await loadMarket(state.market.id);
}));

$('v2-mayhem-on').addEventListener('click', () => action(async () => {
  requireWrite();
  await state.adapter.setMayhem(state.market, true);
  await loadMarket(state.market.id);
}));

$('v2-mayhem-off').addEventListener('click', () => action(async () => {
  requireWrite();
  await state.adapter.setMayhem(state.market, false);
  await loadMarket(state.market.id);
}));

$('v2-support-form').addEventListener('submit', e => {
  e.preventDefault();

  action(async () => {
    requireWrite();

    const amount = parseUnits($('v2-support-amount').value.trim(), 18);

    await state.adapter.supportMarket(state.market, amount);
    await loadMarket(state.market.id);
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
try {
  const response = await fetch('./config.json', { cache: 'no-store' });
  if (!response.ok) throw Error('Unable to load public network configuration');
  state.config = validatePublicConfig(await response.json());
  switchChain('base'); await action(route);
  document.documentElement.dataset.walletAppReady = 'ready';
} catch (error) { status(error.message); controls(); }
