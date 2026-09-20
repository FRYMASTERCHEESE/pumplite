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
  assert.equal(chunks.length, 2, 'Both chain bundles must exist');
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
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
    await page.waitForFunction(() => document.querySelector('#deployment').textContent.includes('Solana Mainnet'));
    assert.equal(await page.locator('#create').isDisabled(), true);
    assert.ok(requests.includes(base + 'config.json'));
    assert.ok(requests.includes(base + 'assets/app.js'));
    assert.ok(requests.includes(base + 'assets/styles.css'));
    assert.ok(!requests.some(url => /\/(solana|base)-/.test(url)), 'No wallet SDK is fetched initially');
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    // Force both production lazy-module graphs to resolve without calling connect or signing.
    for (const chunk of chunks) {
      const type = await page.evaluate(async url => typeof (await import(url)).adapter, base + 'assets/chunks/' + chunk);
      assert.equal(type, 'function');
    }
    await page.selectOption('#chain', 'base');
    assert.match(await page.locator('#deployment').textContent(), /Base Mainnet/);
    assert.equal(await page.locator('#create').isDisabled(), true);
    await page.goto(base + '#solana/not-a-deployment', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('No reviewed deployment'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('No reviewed deployment'));
    await page.locator('#back').click();
    await page.waitForFunction(() => !document.querySelector('#home').hidden);
    assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
    assert.ok(requests.every(url => url === origin + '/pumplite' || url.startsWith(base)), 'All assets stay beneath /pumplite/');
    assert.deepEqual(errors, []);
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
