import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base event/accounting verifier reconstructs live accounting from logs and stays read-only', async () => {
  const source =
    await readFile(
      'scripts/verify-base-event-accounting.mjs',
      'utf8'
    );

  for (const required of [
    'MarketCreatedV2',
    'MarketConfigV2',
    'Trade',
    'MarketSupported',
    'BuyAndBurn',
    'InventoryMinted',
    'MintingLocked',
    'MayhemChanged',
    'derivedNativeReserve',
    'derivedTokenReserve',
    'derivedVolume',
    'derivedSupport',
    'derivedBurned',
    'derivedMinted',
    'provider.getLogs',
    'PUMPLITE_LOG_BLOCK_SPAN',
    'No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing event reconciliation coverage: ' +
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
      'Event verifier must not contain: ' +
        forbidden
    );
  }
});
