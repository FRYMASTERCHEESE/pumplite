import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
// PLAYWRIGHT_MODULE allows use of the host's bundled Playwright without global installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const options = { headless: true };
if (process.env.BROWSER_EXECUTABLE) options.executablePath = process.env.BROWSER_EXECUTABLE;
const browser = await chromium.launch(options);
const preview = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
try {
  await mkdir('build/screenshots', { recursive: true });
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    const publicReads = new Map([
      ['https://pumplite-rpc.coreyedge123.workers.dev/mayhem/capabilities', {version:1, enabled:false, mode:'manual', processorConfigured:false, broadcastEnabled:false}],
      ['https://api.coinbase.com/v2/exchange-rates?currency=SOL', {data:{currency:'SOL', rates:{USD:'150', NZD:'250'}}}]
    ]);
    await page.route('**/*', async route => {
      const request = route.request();
      if (request.url().startsWith(preview)) return route.continue();
      if (publicReads.has(request.url())) {
        assert.equal(request.method(), 'GET');
        assert.equal(request.postData(), null);
        return route.fulfill({json:publicReads.get(request.url())});
      }
      external.push(request.url());
      return route.abort();
    });
    const response = await page.goto(preview, { waitUntil: 'networkidle' });
    assert.equal(response.headers()['x-frame-options'], 'DENY');
    assert.match(response.headers()['content-security-policy'], /frame-ancestors 'none'/);
    await page.waitForFunction(() => document.querySelector('#deployment').textContent.includes('Base Mainnet'));
    async function chooseChain(chain) {
      if (width <= 740) {
        await page.locator('#app-wallet-chip').click();
        await page.locator('#app-sheet-items button')
          .filter({hasText:chain === 'solana' ? 'Solana Mainnet' : 'Base Mainnet'}).click();
      } else {
        await page.selectOption('#chain',chain);
      }
    }
    async function pressConnect() {
      if (width <= 740) {
        await page.locator('#app-wallet-chip').click();
        await page.locator('#app-sheet-items button').filter({hasText:'Connect wallet'}).click();
      } else {
        await page.locator('#connect').click();
      }
    }
    await chooseChain('solana');
    assert.equal(await page.locator('#create').isDisabled(), true);
    assert.equal(
      await page.locator('#refresh').isDisabled(),
      false,
      'Reviewed Pump Mainnet is configured for live reads'
    );
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#chain option').count(), 2);
    await pressConnect();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.toLowerCase().includes('no compatible solana provider'));
    await chooseChain('base');
    assert.match(await page.locator('#deployment').textContent(), /Base Mainnet.*live configuration/);
    await pressConnect();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('No EVM wallet detected'));
    assert.equal(await page.locator('#create').isDisabled(), false, 'Base create remains actionable so a user click can request wallet access');
    assert.equal(await page.locator('#trade').isDisabled(), true);

    await chooseChain('solana');
    await page.screenshot({ path: 'build/screenshots/home-' + width + '.png', fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS browser ' + width + 'px: Base live, Pump Mainnet configured, wallet-gated Solana writes, no overflow, only explicitly mocked read-only endpoints, no page errors');
    await page.close();
  }
} finally { await browser.close(); }

