import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base privileged-action verifier proves transaction provenance and stays read-only', async () => {
  const source =
    await readFile(
      'scripts/verify-base-privileged-actions.mjs',
      'utf8'
    );

  for (const required of [
    'MarketCreatedV2',
    'createMarketV2',
    'MayhemChanged',
    'MarketSupported',
    'InventoryMinted',
    'MintingLocked',
    'setMayhem',
    'supportMarket',
    'mintInventory',
    'lockMintingForever',
    'provider.getTransaction',
    'provider.getTransactionReceipt',
    'PUMPLITE_PRIVILEGED_LOG_BLOCK_SPAN',
    'No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing privileged provenance coverage: ' +
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
      'Privileged-action verifier must not contain: ' +
        forbidden
    );
  }
});
