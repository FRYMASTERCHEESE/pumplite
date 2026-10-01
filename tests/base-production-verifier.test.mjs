import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base production verifier is read-only and covers live Base components', async () => {
  const source =
    await readFile(
      'scripts/verify-base-production.mjs',
      'utf8'
    );

  for (const required of [
    'LaunchFactoryV2',
    'PLITE CurveMarketV2',
    'PLITE LaunchTokenV2',
    'PLITE First 50 claim',
    'factory.isMarket(MARKET)',
    'claim.CLAIM_AMOUNT()',
    'claim.MAX_CLAIMS()',
    'claim.claimCount()',
    'claim.remainingClaims()',
    'token.balanceOf(CLAIM)',
    'pair.token0()',
    'pair.token1()',
    'pair.getReserves()',
    'No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing verifier coverage: ' + required
    );
  }

  assert.doesNotMatch(
    source,
    /BrowserProvider/
  );

  assert.doesNotMatch(
    source,
    /sendTransaction/
  );

  assert.doesNotMatch(
    source,
    /eth_send(?:Raw)?Transaction/
  );

  assert.doesNotMatch(
    source,
    /privateKey/i
  );
});