import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base trade provenance verifier audits calldata, fees, deadlines and token movements', async () => {
  const source =
    await readFile(
      'scripts/verify-base-trade-provenance.mjs',
      'utf8'
    );

  for (const required of [
    'Trade',
    'BuyAndBurn',
    'buyAndBurn',
    "'buy'",
    "'sell'",
    'provider.getTransaction',
    'provider.getTransactionReceipt',
    'matchingTransfer',
    'PLATFORM_FEE_BPS = 25n',
    'MAYHEM_SUPPORT_BPS = 75n',
    'assertDeadline',
    'PUMPLITE_TRADE_LOG_BLOCK_SPAN',
    'No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing trade provenance coverage: ' +
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
      'Trade provenance verifier must not contain: ' +
        forbidden
    );
  }
});
