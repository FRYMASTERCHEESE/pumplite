import { verifyBrowser } from './verified-browser.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, cp, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Export only files GitHub Pages needs, not dist/, node_modules/, web/ or a dev server.
const fixture = await mkdtemp(join(tmpdir(), 'pumplite-pages-'));
let browser, server;
try {
  for (const file of ['index.html', 'config.json', '.nojekyll']) await copyFile(file, join(fixture, file));
  await cp('assets', join(fixture, 'assets'), { recursive: true });
  const mount = '/pumplite/';
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path === '/pumplite') { res.writeHead(301, { Location: mount }); res.end(); return; }
      if (!path.startsWith(mount)) throw Error('Outside project mount');
      const file = resolve(fixture, path.slice(mount.length) || 'index.html');
      if (!file.startsWith(fixture + sep)) throw Error('Outside exported site');
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port, base = origin + mount;
  assert.equal((await fetch(origin + '/assets/app.js')).status, 404, 'No root-path fallback');
  assert.equal((await fetch(base + 'web/app.js')).status, 404, 'Source modules must not be available');
  assert.equal((await fetch(base + 'node_modules/@solana/web3.js')).status, 404, 'No Node resolution fallback');
  const chunks = (await readdir('assets/chunks')).filter(name => /^(solana|base)-.*\.js$/.test(name));
  assert.equal(chunks.filter(name => /^solana-/.test(name)).length, 1, 'Solana bundle must exist exactly once');
  assert.equal(chunks.filter(name => /^base-(?!v2-)/.test(name)).length, 1, 'Base V1 compatibility bundle must exist exactly once');
  assert.equal(chunks.filter(name => /^base-v2-/.test(name)).length, 1, 'Base V2 bundle must exist exactly once');
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  await verifyBrowser(browser,base);
  const broken = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await broken.route('**/assets/app.js*', route => route.abort());
  await broken.goto(base);
  await broken.locator('#connect').click();
  assert.match(await broken.locator('#phantom-tap').textContent(), /Tap received.*not ready/);
  const box = await broken.locator('#phantom-diagnostics').boundingBox();
  assert.ok(box && box.y < 400 && box.y + box.height < 844, 'Diagnostic visible near Connect without scrolling');
  await broken.close();
  const phantom = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phantom.addInitScript(() => {
    const key = { toBase58: () => '11111111111111111111111111111112', equals: other => other?.toBase58() === '11111111111111111111111111111112' };
    window.phantom = { solana: { publicKey: key, signTransaction() { throw Error('No signing allowed'); },
      connect() { window.syntheticApprovalActive = navigator.userActivation.isActive; return Promise.resolve({ publicKey: key }); } } };
  });
  await phantom.route('https://pumplite-rpc.coreyedge123.workers.dev/rpc', async route => {
    const request = route.request().postDataJSON();
    assert.equal(request.method, 'getGenesisHash');
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' } });
  });
  await phantom.goto(base+'#solana');
  await phantom.waitForFunction(() => document.documentElement.dataset.walletAppReady === 'ready');
  await phantom.locator('#connect').click();
  await phantom.waitForFunction(() => document.querySelector('#connect').textContent === 'Approve in Phantom');
  assert.match(await phantom.locator('#wallet-diagnostic').textContent(), /Phantom ready/);
  await phantom.locator('#connect').click();
  await phantom.waitForFunction(() => document.querySelector('#connect').textContent.startsWith('Disconnect'));
  assert.equal(await phantom.evaluate(() => window.syntheticApprovalActive), true);
  assert.equal(await phantom.locator('#create').isDisabled(), true);
  await phantom.close();

  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), errors = [], failed = [], requests = [];
    await context.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      failed.push('External request: ' + route.request().url()); return route.abort();
    });
    await context.addInitScript(() => {
      window.__walletCalls = [];
      const forbidden = method => { window.__walletCalls.push(method); throw Error('Wallet method prohibited in static test'); };
      // Traps only: no accounts, balances, wallet connection or transaction simulation.
      window.ethereum = { on() {}, request: () => forbidden('ethereum.request') };
      window.solana = { on() {}, connect: () => forbidden('solana.connect'), signTransaction: () => forbidden('solana.signTransaction') };
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', req => failed.push(req.url()));
    page.on('response', response => { if (response.status() >= 400) failed.push(response.status() + ' ' + response.url()); });
    page.on('request', req => requests.push(req.url()));
    await page.goto(origin + '/pumplite', { waitUntil: 'networkidle' });
    assert.equal(page.url(), base);
    await page.waitForFunction(() => document.querySelector('#deployment').textContent.includes('Base Mainnet'));
    assert.equal(await page.locator('#create').isDisabled(), false, 'Base create button stays actionable before wallet access; wallet access is requested only after click');
    assert.ok(requests.some(url => url.startsWith(base + 'config.json?boot=')));
    assert.ok(requests.some(url => url.startsWith(base + 'assets/app.js?boot=')));
    assert.ok(requests.includes(base + 'assets/styles.css'));
    assert.ok(!requests.some(url => /\/(solana|base)-/.test(url)), 'No wallet SDK is fetched initially');
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    // Force both production lazy-module graphs to resolve without calling connect or signing.
    for (const chunk of chunks) {
      const type = await page.evaluate(async url => typeof (await import(url)).adapter, base + 'assets/chunks/' + chunk);
      assert.equal(type, 'function');
    }
    // Check the published guard without RPC requests or wallet calls.
    const chainGuard = await page.evaluate(async ({ url, configUrl }) => {
      const { adapter } = await import(url);
      const { solana } = await (await fetch(configUrl)).json();
      adapter(solana, () => {});
      try {
        adapter({ ...solana, genesisHash: solana.genesisHash.slice(0, 32) }, () => {});
        return false;
      } catch (error) { return error.message === 'RPC is not Solana Mainnet'; }
    }, { url: base + 'assets/chunks/' + chunks.find(chunk => chunk.startsWith('solana-')), configUrl: base + 'config.json' });
    assert.equal(chainGuard, true, 'Published Solana adapter rejects truncated chain configuration');
    await page.locator('#skip-content').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
    assert.equal(await page.locator('#amount').getAttribute('maxlength'), '96');
    await page.locator('#name').fill('Local document');
    await page.locator('#symbol').fill('DOC');
    await page.locator('#advanced-metadata summary').click();
    assert.equal(await page.locator('#download-metadata').textContent(), 'Copy metadata JSON');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => {} }
      });
    });
    await page.locator('#download-metadata').click();
    await page.waitForFunction(() =>
      document.querySelector('#status-text').textContent.includes('Metadata JSON copied to clipboard')
    );
    await page.selectOption('#chain', 'base');
    assert.match(await page.locator('#deployment').textContent(), /Base Mainnet/);
    assert.equal(await page.locator('#create').isDisabled(), false);
    await page.goto(base + '#solana/not-a-deployment', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('No reviewed deployment'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('No reviewed deployment'));
    await page.locator('#back').click();
    await page.waitForFunction(() => !document.querySelector('#home').hidden);
    await page.evaluate(() => {
      document.querySelector('#home').hidden = true;
      document.querySelector('#market-page').hidden = false;
      document.querySelector('#market-metadata').textContent = '<img src=x onerror=alert(1)> https://example.invalid/' + 'x'.repeat(175);
    });
    assert.equal(await page.locator('#market-metadata img').count(), 0);
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
    assert.ok(requests.every(url => url === origin + '/pumplite' || url.startsWith(base)), 'All assets stay beneath /pumplite/');
    // Pages cannot set frame-ancestors headers; verify the app's fail-closed fallback too.
    await page.evaluate(url => { const frame=document.createElement('iframe');frame.id='frame-check';frame.src=url;document.body.append(frame); },base);
    await page.waitForFunction(()=>document.querySelector('#frame-check')?.contentDocument?.body?.textContent.includes('Embedded wallet interactions are disabled'));
    assert.deepEqual(errors.filter(e=>e!=='Embedded PumpLite is disabled'), []);
    assert.ok(errors.includes('Embedded PumpLite is disabled'));
    assert.deepEqual(failed, []);
    console.log('PASS Pages export ' + width + 'px: /pumplite/, both production SDK imports, lazy loading, config/CSS, hash reload, no errors/404s/external requests/wallet calls');
    await context.close();
  }
} finally {
  await browser?.close();
  if (server) await new Promise(done => { server.close(done); server.closeAllConnections(); });
  // Only the unique mkdtemp directory created by this test is removed.
  await rm(fixture, { recursive: true, force: true });
}
