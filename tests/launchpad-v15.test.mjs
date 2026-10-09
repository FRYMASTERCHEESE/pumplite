import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PumpLite V15 exposes launchpad-style token identity, market stats and truthful Solana analytics', async () => {
  const [html, app, solana, styles] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('web/app.js', 'utf8'),
    readFile('web/adapters/solana-tiny.js', 'utf8'),
    readFile('web/styles.css', 'utf8')
  ]);

  for (const id of [
    'market-token-summary',
    'market-token-avatar',
    'market-summary-address',
    'copy-market-token',
    'market-hero-price',
    'market-hero-cap',
    'market-hero-holders',
    'market-hero-backing',
    'market-hero-progress'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }

  assert.match(html, /<option value="market-cap">Market cap</option>/);
  assert.match(html, /Curve progress/);
  assert.match(app, /loadTokenMedia/);
  assert.match(app, /loadMarketTokenSummary/);
  assert.match(app, /renderTokenDetailCard/);
  assert.match(app, /market-cap/);
  assert.match(app, /coverageComplete/);
  assert.match(solana, /async tradeHistory/);
  assert.match(solana, /async marketStats24h/);
  assert.match(solana, /async holderStats/);
  assert.match(solana, /getSignaturesForAddress/);
  assert.match(solana, /getProgramAccounts/);
  assert.match(styles, /.token-hero-card/);
  assert.match(styles, /.token-card-progress/);

  assert.doesNotMatch(app, /$45,094|$5,675/);
  assert.doesNotMatch(html, /$45,094|$5,675/);
});
