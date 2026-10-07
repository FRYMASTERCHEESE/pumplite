import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public-site verifier is read-only and covers live production pages', async () => {
  const source =
    await readFile(
      'scripts/verify-public-site.mjs',
      'utf8'
    );

  for (const required of [
    'https://frymastercheese.github.io/pumplite/',
    'claim.html',
    'terms.html',
    'privacy.html',
    'risk.html',
    'config.json',
    'assets/plite-info.json',
    'assets/verified-tokens.json',
'assets/styles.css',
    'const expectedStatus =',
    'const expectedV3Deploy =',
    'https://pumplite-rpc.coreyedge123.workers.dev/launch/activated/',
    'SOLANA + BASE MAINNET',
    'id="mobile-phantom"',
    'Base V2 live; PumpLite tiny Solana Mainnet integration is enabled with production discovery and wallet-gated writes.',
    'No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing live-site verification: ' + required
    );
  }

  for (const forbidden of [
    'BrowserProvider',
    'sendTransaction',
    'eth_sendTransaction',
    'eth_requestAccounts',
'privateKey',
    '20261003pump3'
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      'Public-site verifier must not contain: ' + forbidden
    );
  }
});
