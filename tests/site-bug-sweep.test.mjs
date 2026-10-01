import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path =>
  readFile(path, 'utf8');

test('V3 creation UI keeps capped mintable supply fully usable', async () => {
  const source = await read('web/app.js');

  assert.match(
    source,
    /create-supply-fact'\)\.textContent = baseModern/
  );

  assert.match(
    source,
    /create-supply-mode-fact'\)\.textContent = baseModern/
  );

  assert.match(
    source,
    /v2-max-supply'\)\.disabled =[\s\S]*?!baseModern/
  );

  assert.doesNotMatch(
    source,
    /v2-max-supply'\)\.disabled =[\s\S]{0,120}!baseV2/
  );
});

test('V3 organic distribution and trade charts exclude agent custody correctly', async () => {
  const source = await read('web/app.js');

  assert.match(
    source,
    /m\.tokenReserve \+\s*\(m\.agentInventory \|\| 0n\)/
  );

  assert.match(
    source,
    /!\[2, 3\]\.includes\(market\.contractVersion\)/
  );

  assert.match(
    source,
    /Trade chart is available for Base V2\/V3 markets/
  );
});

test('creator and controller actions are permission-gated in the UI', async () => {
  const source = await read('web/app.js');

  for (const marker of [
    'const creatorWallet',
    'const controllerWallet',
    "!creatorWallet",
    "!controllerWallet"
  ]) {
    assert.ok(
      source.includes(marker),
      'Missing permission-gating marker: ' + marker
    );
  }
});

test('V3 deployment revalidates wallet state and constructor settings', async () => {
  const source = await read('web/v3-deploy.js');

  for (const marker of [
    'watchWallet',
    'accountsChanged',
    'chainChanged',
    'eth_accounts',
    'requireCurrentWallet',
    'ZeroAddress',
    'mayhemLimits',
    'V3 Mayhem limit read-back mismatch',
    'receipt.from',
    'copyText'
  ]) {
    assert.ok(
      source.includes(marker),
      'Missing V3 deployment hardening: ' + marker
    );
  }
});

test('public build and live monitoring include every auxiliary page', async () => {
  const build = await read('scripts/build.mjs');
  const pages = await read('tests/pages.mjs');
  const publicCheck = await read('scripts/verify-public-site.mjs');
  const workflow = await read('.github/workflows/public-site-health.yml');

  for (const marker of [
    'status.js',
    'manifest.webmanifest',
    'robots.txt',
    'sitemap.xml',
    'token-list.json',
    '.well-known'
  ]) {
    assert.ok(
      build.includes(marker),
      'Build export missing ' + marker
    );

    assert.ok(
      pages.includes(marker),
      'Pages fixture missing ' + marker
    );
  }

  for (const marker of [
    'verification.html',
    'status.html',
    'v3-deploy.html',
    'assets/v3-deploy.js',
    '.well-known/security.txt'
  ]) {
    assert.ok(
      publicCheck.includes(marker),
      'Public live verifier missing ' + marker
    );
  }

  for (const marker of [
    '"verification.html"',
    '"status.html"',
    '"status.js"',
    '"v3-deploy.html"',
    '"manifest.webmanifest"',
    '"robots.txt"',
    '"sitemap.xml"',
    '"token-list.json"',
    '".well-known/**"'
  ]) {
    assert.ok(
      workflow.includes(marker),
      'Public health trigger missing ' + marker
    );
  }
});

test('browser entrypoint cache keys were advanced together', async () => {
  const index = await read('index.html');
  const claim = await read('claim.html');
  const status = await read('status.html');
  const v3 = await read('v3-deploy.html');

  for (const [name, html] of [
    ['index', index],
    ['claim', claim],
    ['status', status],
    ['v3', v3]
  ]) {
    assert.ok(
      html.includes('boot=20261002bugs2'),
      name + ' did not receive the current release cache key'
    );
  }
});
test('public-site health verifier stays strictly wallet-action free', async () => {
  const source =
    await read('scripts/verify-public-site.mjs');

  for (const forbidden of [
    'BrowserProvider',
    'sendTransaction',
    'eth_sendTransaction',
    'eth_requestAccounts',
    'privateKey'
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      'Read-only live verifier contains forbidden wallet behavior marker: ' +
        forbidden
    );
  }

  for (const safeMarker of [
    'V3 Mayhem limit read-back mismatch',
    'Mayhem controller cannot be the zero address',
    'Wallet account changed',
    'mayhemLimits',
    'accountsChanged',
    'chainChanged'
  ]) {
    assert.ok(
      source.includes(safeMarker),
      'Read-only live verifier is missing safe V3 structural marker: ' +
        safeMarker
    );
  }
});
test('verification page identity and encoding stay aligned with live health', async () => {
  const html =
    await read('verification.html');

  const publicCheck =
    await read(
      'scripts/verify-public-site.mjs'
    );

  assert.ok(
    html.includes(
      '<h1>Verify PLITE</h1>'
    ),
    'Verification page stable heading is missing'
  );

  assert.ok(
    publicCheck.includes(
      "'<h1>Verify PLITE</h1>'"
    ),
    'Live health verifier is not checking the real verification-page heading'
  );

  assert.equal(
    publicCheck.includes(
      'PLITE Token Verification'
    ),
    false,
    'Obsolete verification-page marker returned'
  );

  for (const broken of [
    '\u00e2\u20ac\u0153',
    '\u00e2\u20ac\u009d',
    '\uFFFD'
  ]) {
    assert.equal(
      html.includes(broken),
      false,
      'Verification page contains encoding corruption: ' +
        broken
    );
  }

  assert.ok(
    html.includes(
      '&ldquo;Verified by PumpLite&rdquo;'
    ),
    'Verification disclosure quote is not encoded safely'
  );
});
test('wallet-sensitive secondary pages fail closed when embedded', async () => {
  const claim =
    await read('web/claim.js');

  const v3 =
    await read('web/v3-deploy.js');

  assert.ok(
    claim.includes(
      'Embedded PumpLite claim is disabled'
    )
  );

  assert.ok(
    v3.includes(
      'Embedded PumpLite V3 deployment is disabled'
    )
  );
});

test('public V3 live verifier does not mistake real wording for simulation mode', async () => {
  const source =
    await read(
      'scripts/verify-public-site.mjs'
    );

  assert.ok(
    source.includes(
      'SIMULATION ONLY|mayhem-playground'
    )
  );

  assert.equal(
    source.includes(
      '!/simulation/i.test(v3DeployPage)'
    ),
    false
  );
});