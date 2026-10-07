import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const siteRoot =
  'https://frymastercheese.github.io/pumplite/';

const localIndex =
  await readFile('index.html', 'utf8');

const localClaim =
  await readFile('claim.html', 'utf8');

const localStatus =
  await readFile('status.html', 'utf8');

const localV3Deploy =
  await readFile('v3-deploy.html', 'utf8');

const localConfig =
  JSON.parse(
    await readFile('config.json', 'utf8')
  );

const localPlite =
  JSON.parse(
    await readFile(
      'web/plite-info.json',
      'utf8'
    )
  );

const localRegistry =
  JSON.parse(
    await readFile(
      'web/verified-tokens.json',
      'utf8'
    )
  );

function assetSource(html, filename) {
  const marker =
    './assets/' + filename + '?boot=';

  const markerIndex =
    html.indexOf(marker);

  assert.ok(
    markerIndex >= 0,
    'Local ' + filename + ' boot asset reference missing'
  );

  const start =
    markerIndex + 2;

  const end =
    html.indexOf('"', start);

  assert.ok(
    end > start,
    'Local ' + filename + ' boot asset reference is malformed'
  );

  return html.slice(start, end);
}

const expectedApp =
  assetSource(localIndex, 'app.js');

const expectedClaim =
  assetSource(localClaim, 'claim.js');

function bootSource(
  html,
  path
) {
  const marker =
    './' + path + '?boot=';

  const markerIndex =
    html.indexOf(marker);

  assert.ok(
    markerIndex >= 0,
    'Local ' + path + ' boot asset reference missing'
  );

  const start =
    markerIndex + 2;

  const end =
    html.indexOf(
      '"',
      start
    );

  assert.ok(
    end > start,
    'Local ' + path + ' boot asset reference is malformed'
  );

  return html.slice(
    start,
    end
  );
}

const expectedStatus =
  bootSource(
    localStatus,
    'status.js'
  );

const expectedV3Deploy =
  bootSource(
    localV3Deploy,
    'assets/v3-deploy.js'
  );

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

async function fetchText(
  path,
  timeoutMs = 15_000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const separator =
      path.includes('?') ? '&' : '?';

    const url =
      siteRoot +
      path +
      separator +
      'pumplite_health=' +
      Date.now();

    const response =
      await fetch(
        url,
        {
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            accept: '*/*'
          }
        }
      );

    assert.equal(
      response.status,
      200,
      path + ' HTTP status'
    );

    const body =
      await response.text();

    assert.ok(
      body.length > 20,
      path + ' response unexpectedly small'
    );

    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(path) {
  return JSON.parse(
    await fetchText(path)
  );
}

async function verifyOnce() {
  const [
    index,
    claim,
    terms,
    privacy,
    risk,
    liveConfig,
    livePlite,
    liveRegistry
  ] = await Promise.all([
    fetchText(''),
    fetchText('claim.html'),
    fetchText('terms.html'),
    fetchText('privacy.html'),
    fetchText('risk.html'),
    fetchJson('config.json'),
    fetchJson('assets/plite-info.json'),
    fetchJson('assets/verified-tokens.json')
  ]);

  const [
    verificationPage,
    statusPage,
    v3DeployPage,
    statusScript,
    manifest,
    robots,
    sitemap,
    tokenList,
    securityText,
    v3DeployBundle
  ] = await Promise.all([
    fetchText('verification.html'),
    fetchText('status.html'),
    fetchText('v3-deploy.html'),
    fetchText(expectedStatus),
    fetchJson('manifest.webmanifest'),
    fetchText('robots.txt'),
    fetchText('sitemap.xml'),
    fetchJson('token-list.json'),
    fetchText('.well-known/security.txt'),
    fetchText(expectedV3Deploy)
  ]);

  assert.ok(
    verificationPage.includes(
      '<h1>Verify PLITE</h1>'
    ),
    'Live verification page marker missing'
  );

  assert.ok(
    statusPage.includes(
      'PLITE verification &amp; discovery'
    ) &&
    statusPage.includes(
      'src="./' + expectedStatus + '"'
    ),
    'Live status page or status script reference is stale'
  );

  assert.ok(
    v3DeployPage.includes(
      'Deploy PumpLite V3'
    ) &&
    v3DeployPage.includes(
      'src="./' + expectedV3Deploy + '"'
    ) &&
    v3DeployPage.includes(
      'REAL BASE MAINNET'
    ) &&
    !/SIMULATION ONLY|mayhem-playground/i.test(
      v3DeployPage
    ),
    'Live V3 deployment page is missing or stale'
  );

  assert.ok(
    statusScript.includes(
      'Refreshing read-only public verification checks'
    ),
    'Live status script marker missing'
  );

  assert.equal(
    manifest.name,
    'PumpLite',
    'Live web manifest identity mismatch'
  );

  assert.ok(
    robots.includes(
      'sitemap.xml'
    ),
    'Live robots.txt is missing the sitemap'
  );

  assert.ok(
    sitemap.includes(
      '/verification.html'
    ) &&
    sitemap.includes(
      '/status.html'
    ),
    'Live sitemap is incomplete'
  );

  assert.ok(
    tokenList.tokens?.some(
      item =>
        String(item.address || '').toLowerCase() ===
        '0xb15a460142c77b42cdf57815b0eefeb24b593196'
    ),
    'Live token list is missing official PLITE'
  );

  assert.ok(
    securityText.length > 20,
    'Live security contact is unexpectedly empty'
  );

  for (const marker of [
    'wallet_switchEthereumChain',
    'V3 Mayhem limit read-back mismatch',
    'Mayhem controller cannot be the zero address',
    'Wallet account changed',
    'Embedded PumpLite V3 deployment is disabled',
    'queueMicrotask',
    'mayhemLimits',
    'accountsChanged',
    'chainChanged'
  ]) {
    assert.ok(
      v3DeployBundle.includes(marker),
      'Live V3 deployment bundle is missing: ' +
        marker
    );
  }

  assert.ok(
    index.includes(
      'src="./' + expectedApp + '"'
    ),
    'Live home page is not on the expected app build yet'
  );

  assert.ok(
    claim.includes(
      'src="./' + expectedClaim + '"'
    ),
    'Live claim page is not on the expected claim build yet'
  );

  for (const required of [
    'SOLANA + BASE MAINNET',
    'id="mobile-phantom"',
    'id="mobile-coinbase"',
    'id="mobile-open"',
    'href="./claim.html"',
    'href="./terms.html"',
    'href="./privacy.html"',
    'href="./risk.html"'
  ]) {
    assert.ok(
      index.includes(required),
      'Live home missing: ' + required
    );
  }

  for (const required of [
    'First 50 PLITE Holders',
    'id="claim-connect"',
    'id="claim-now"',
    'View PLITE token'
  ]) {
    assert.ok(
      claim.includes(required),
      'Live claim page missing: ' + required
    );
  }

  assert.ok(
    terms.includes('Terms of Use'),
    'Live Terms page marker missing'
  );

  assert.ok(
    privacy.includes('Privacy'),
    'Live Privacy page marker missing'
  );

  assert.ok(
    risk.includes('Risk'),
    'Live Risk page marker missing'
  );

  assert.deepEqual(
    liveConfig,
    localConfig,
    'Live config.json differs from this commit'
  );

  assert.deepEqual(
    livePlite,
    localPlite,
    'Live PLITE public record differs from this commit'
  );

  assert.deepEqual(
    liveRegistry,
    localRegistry,
    'Live reviewed-token registry differs from this commit'
  );

  assert.equal(
    liveConfig.base.chainId,
    8453
  );

  assert.equal(
    liveConfig.base.contractVersion,
    2
  );

  assert.equal(
    liveConfig.base.transactionsEnabled,
    true
  );

  assert.equal(
    liveConfig.solana.transactionsEnabled,
    true
  );

  assert.equal(
    liveConfig.solana.protocol,
    'tiny'
  );

  assert.equal(
    liveConfig.solana.programId,
    '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'
  );

  assert.equal(
    liveConfig.solana.clientVersion,
    5
  );

  assert.equal(
    liveConfig.solana.ammProgramId,
    undefined
  );

  assert.equal(
    liveConfig.solana.mayhemProgramId,
    undefined
  );

  assert.equal(
    liveConfig.solana.discoveryUrl,
    'https://pumplite-rpc.coreyedge123.workers.dev/launch/activated/'
  );

  assert.deepEqual(
    liveConfig.solana.rpcFallbackUrls,
    ['https://solana-rpc.publicnode.com']
  );

  assert.equal(
    liveConfig.base.holderClaim.enabled,
    true
  );

  assert.equal(
    liveConfig.base.holderClaim.contract,
    '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2'
  );

  const [
    appBundle,
    claimBundle,
    styles
  ] = await Promise.all([
    fetchText(expectedApp),
    fetchText(expectedClaim),
    fetchText('assets/styles.css')
  ]);

  assert.ok(
    appBundle.includes('phantom.app'),
    'Live app bundle is missing Phantom handoff support'
  );

  assert.ok(
    appBundle.includes('mobile-phantom'),
    'Live app bundle is missing Phantom Base UI wiring'
  );

  assert.ok(
    claimBundle.includes('phantom.app'),
    'Live claim bundle is missing Phantom handoff support'
  );

  assert.ok(
    claimBundle.includes(
      'Embedded PumpLite claim is disabled'
    ),
    'Live claim bundle is missing iframe wallet protection'
  );

  assert.ok(
    styles.length > 1000,
    'Live stylesheet is unexpectedly small'
  );

  console.log('');
  console.log(
    'PASS - live PumpLite public site matches this commit'
  );
  console.log('Site:', siteRoot);
  console.log('App asset:', expectedApp);
  console.log('Claim asset:', expectedClaim);
  console.log(
    'Base V2 live; PumpLite tiny Solana Mainnet integration is enabled with production discovery and wallet-gated writes.'
  );
  console.log(
    'No wallet used. No signature requested. No transaction submitted.'
  );
}

const attempts =
  Number(
    process.env.PUMPLITE_SITE_VERIFY_ATTEMPTS || 1
  );

const delayMs =
  Number(
    process.env.PUMPLITE_SITE_VERIFY_DELAY_MS || 15_000
  );

assert.ok(
  Number.isInteger(attempts) &&
    attempts >= 1 &&
    attempts <= 30,
  'Invalid PUMPLITE_SITE_VERIFY_ATTEMPTS'
);

let lastError = null;

for (
  let attempt = 1;
  attempt <= attempts;
  attempt++
) {
  try {
    console.log(
      'Public-site verification attempt ' +
      attempt +
      '/' +
      attempts
    );

    await verifyOnce();
    lastError = null;
    break;
  } catch (error) {
    lastError = error;

    console.warn(
      'Attempt ' +
      attempt +
      ' failed: ' +
      (
        error?.message ||
        String(error)
      )
    );

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }
}

if (lastError) {
  throw lastError;
}
