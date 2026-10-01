import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('all-market Base verifier is read-only and checks core production invariants', async () => {
  const source =
    await readFile(
      'scripts/verify-base-markets.mjs',
      'utf8'
    );

  for (const required of [
    'factory.marketCount',
    'factory.markets',
    'factory.isMarket',
    'market.nativeReserve',
    'market.tokenReserve',
    'market.totalBurned',
    'token.totalSupply',
    'token.totalMinted',
    'token.maxSupply',
    'token.mintableAtLaunch',
    'token.mintingLocked',
    'token.remainingMintAllowance',
    'token.balanceOf',
    'provider.getBalance',
    'totalMinted - totalSupply',
    'tokenBalance >= tokenReserve',
    'nativeBalance >= nativeReserve',
    'No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing invariant coverage: ' + required
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
      'Verifier must not contain: ' + forbidden
    );
  }
});
