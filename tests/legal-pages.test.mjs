import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pages = {
  terms: await readFile('terms.html', 'utf8'),
  privacy: await readFile('privacy.html', 'utf8'),
  risk: await readFile('risk.html', 'utf8')
};

test('public legal pages exist and stay linked from the product', async () => {
  const index = await readFile('index.html', 'utf8');
  const claim = await readFile('claim.html', 'utf8');
  const build = await readFile('scripts/build.mjs', 'utf8');

  for (const file of [
    'terms.html',
    'privacy.html',
    'risk.html'
  ]) {
    assert.match(index, new RegExp('href="\\./' + file + '"'));
    assert.match(claim, new RegExp('href="\\./' + file + '"'));
    assert.match(build, new RegExp("'" + file.replace('.', '\\.') + "'"));
  }
});

test('Terms accurately describe current Base V2 fee and custody model', () => {
  assert.match(pages.terms, /non-custodial software/i);
  assert.match(pages.terms, /0\.25% platform fee/);
  assert.match(pages.terms, /additional 0\.75%/);
  assert.match(pages.terms, /no separate PumpLite token-creation fee/i);
  assert.match(pages.terms, /Base network gas still applies/i);
  assert.match(pages.terms, /mintable/i);
  assert.match(pages.terms, /independent third-party smart-contract audit/i);
});

test('Privacy describes public chain and metadata publishing without claiming custody', () => {
  assert.match(pages.privacy, /wallet addresses/i);
  assert.match(pages.privacy, /does not ask for or need your seed phrase or private key/i);
  assert.match(pages.privacy, /IPFS/i);
  assert.match(pages.privacy, /wallet-signed authorization/i);
  assert.match(pages.privacy, /does not include a PumpLite user-account system/i);
});

test('Risk page distinguishes PumpLite curve liquidity from external DEX liquidity', () => {
  assert.match(pages.risk, /Tokens can lose all value/);
  assert.match(pages.risk, /PumpLite curve versus external DEX liquidity/);
  assert.match(pages.risk, /Uniswap V2 PLITE\/WETH pool/);
  assert.match(pages.risk, /does not guarantee that Phantom, BaseScan/i);
  assert.match(pages.risk, /independent third-party smart-contract audit/i);
});

test('legal pages are static and ASCII-only', () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.doesNotMatch(html, /<script/i, name + ' must not execute JavaScript');
    assert.doesNotMatch(html, /[^\x00-\x7F]/, name + ' must remain ASCII-only');
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'none'/);
  }
});
