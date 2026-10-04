import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Steps 51-130 verifier exposes all 80 static hardening gates and no transaction capability', async () => {
  const source = await readFile('scripts/verify-hardening-51-130.mjs', 'utf8');

  for (let step = 51; step <= 130; step++) {
    assert.ok(
      source.includes('pass(' + step + ',') ||
      source.includes('pass(\n  ' + step + ',') ||
      source.includes('pass(\n    ' + step + ','),
      'Missing hardening step ' + step
    );
  }

  for (const required of [
    'package identity and private ESM boundary',
    'official Base V2 factory seal',
    'reviewed PumpLite Mainnet transaction safety lock',
    'First 50 claim identities',
    'PLITE/WETH pair identity',
    'factory metadata validation',
    'five-minute maximum deadline',
    'token lifetime mint cap',
    'claim full-remaining-funding requirement',
    'frontend wallet metadata and RPC safety mesh',
    'publishing headers and CI supply-chain safety',
    'complete production monitoring and release-hardening mesh',
    'Static/local verification only. No wallet used. No signature requested. No transaction submitted. No ETH spent.'
  ]) assert.ok(source.includes(required), 'Missing marker: ' + required);

  for (const forbidden of [
    'BrowserProvider(',
    'sendTransaction(',
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'new Wallet(',
    'privateKey ='
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      'Static hardening verifier must not gain transaction capability: ' + forbidden
    );
  }
});
