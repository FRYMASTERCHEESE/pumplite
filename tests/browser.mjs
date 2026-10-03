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
    page.on('request', req => { if (!req.url().startsWith(preview)) external.push(req.url()); });
    const response = await page.goto(preview, { waitUntil: 'networkidle' });
    assert.equal(response.headers()['x-frame-options'], 'DENY');
    assert.match(response.headers()['content-security-policy'], /frame-ancestors 'none'/);
    await page.waitForFunction(() => document.querySelector('#deployment').textContent.includes('Base Mainnet'));
    await page.selectOption('#chain','solana');
    assert.equal(await page.locator('#create').isDisabled(), true);
    assert.equal(
      await page.locator('#refresh').isDisabled(),
      false,
      'Reviewed Pump Mainnet is configured for live reads'
    );
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#chain option').count(), 2);
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('No compatible Solana provider'));
    await page.selectOption('#chain', 'base');
    assert.match(await page.locator('#deployment').textContent(), /Base Mainnet.*live configuration/);
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('No EVM wallet detected'));
    assert.equal(await page.locator('#create').isDisabled(), false, 'Base create remains actionable so a user click can request wallet access');
    assert.equal(await page.locator('#trade').isDisabled(), true);

    await page.selectOption('#chain', 'solana');
    await page.screenshot({ path: 'build/screenshots/home-' + width + '.png', fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS browser ' + width + 'px: Base live, Pump Mainnet configured, wallet-gated Solana writes, no overflow, no external requests, no page errors');
    await page.close();
  }
} finally { await browser.close(); }

