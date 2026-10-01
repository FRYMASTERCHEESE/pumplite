import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base write-path verifier uses eth_call simulations and covers authority boundaries', async () => {
  const source =
    await readFile(
      'scripts/verify-base-write-sim.mjs',
      'utf8'
    );

  for (const required of [
    "'eth_call'",
    'createMarketV2',
    'Invalid metadata creation',
    'Invalid fixed-supply creation',
    'setMayhem',
    'mintInventory',
    'lockMintingForever',
    'mintToMarket',
    'burnFromMarket',
    'Unauthorized setMayhem',
    'Unauthorized mintInventory',
    'Unauthorized direct token mint',
    'Unauthorized direct token burn',
    'eth_call only. No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing write simulation coverage: ' +
        required
    );
  }

  for (const forbidden of [
    'BrowserProvider',
    'sendTransaction',
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'eth_requestAccounts',
    'privateKey'
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      'Write simulation verifier must not contain: ' +
        forbidden
    );
  }
});
