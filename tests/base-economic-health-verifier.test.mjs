import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base economic health verifier independently checks quote math and Mayhem state', async () => {
  const source =
    await readFile(
      'scripts/verify-base-economic-health.mjs',
      'utf8'
    );

  for (const required of [
    'PLATFORM_FEE_EXPECTED = 25n',
    'MAYHEM_SUPPORT_EXPECTED = 75n',
    'VIRTUAL_NATIVE_EXPECTED = 10n ** 18n',
    'INITIAL_MAYHEM_DURATION_EXPECTED',
    'market.quoteBuy',
    'market.quoteSell',
    'market.mayhemActive',
    'market.initialMayhem',
    'market.manualMayhem',
    'market.tokenReserve',
    'market.nativeReserve',
    'token.totalSupply',
    'buyMath',
    'sellMath',
    'firstPositiveSellInput',
    'No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing economic health coverage: ' +
        required
    );
  }

  for (const forbidden of [
    'BrowserProvider',
    'sendTransaction',
    'eth_sendTransaction',
    'eth_requestAccounts',
    'privateKey'
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      'Economic verifier must not contain: ' +
        forbidden
    );
  }
});
