import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
// PLAYWRIGHT_MODULE allows use of the host's bundled Playwright without global installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const options = { headless: true };
if (process.env.BROWSER_EXECUTABLE) options.executablePath = process.env.BROWSER_EXECUTABLE;
const browser = await chromium.launch(options);
try {
  await mkdir('build/screenshots', { recursive: true });
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4173/')) external.push(req.url()); });
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#deployment').textContent.includes('Solana Mainnet'));
    assert.equal(await page.locator('#create').isDisabled(), true);
    assert.equal(await page.locator('#refresh').isDisabled(), true);
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#chain option').count(), 2);
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('Install a compatible Solana wallet'));
    await page.selectOption('#chain', 'base');
    assert.match(await page.locator('#deployment').textContent(), /Base Mainnet.*no deployment/);
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('Install an EVM wallet'));
    assert.equal(await page.locator('#create').isDisabled(), true);
    await page.locator('#market-address').fill('not-a-market');
    await page.locator('#open-form button').click();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('No reviewed deployment'));
    assert.equal(await page.locator('#trade').isDisabled(), true);
    await page.locator('#back').click();
    await page.waitForFunction(() => !document.querySelector('#home').hidden);
    await page.locator('#market-address').fill('');
    await page.selectOption('#chain', 'solana');
    await page.screenshot({ path: 'build/screenshots/home-' + width + '.png', fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS browser ' + width + 'px: disabled writes, both networks, navigation, no overflow, no external requests, no page errors');
    await page.close();
  }
} finally { await browser.close(); }
