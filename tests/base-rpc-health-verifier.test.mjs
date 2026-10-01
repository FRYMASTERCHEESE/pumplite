import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base RPC health verifier checks every configured endpoint independently and stays read-only', async () => {
  const source =
    await readFile(
      'scripts/verify-base-rpc-health.mjs',
      'utf8'
    );

  for (const required of [
    'config.base.rpcUrl',
    'config.base.rpcFallbackUrls',
    'eth_chainId',
    'provider.getBlockNumber',
    'provider.getBlock',
    'provider.getCode',
    'factory.marketCount',
    'factory.mayhemController',
    'factory.treasury',
    'factory.isMarket',
    'PUMPLITE_RPC_MAX_BLOCK_LAG',
    'PUMPLITE_RPC_MAX_STALE_SECONDS',
    'commonBlock',
    'No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing RPC health coverage: ' +
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
      'RPC health verifier must not contain: ' +
        forbidden
    );
  }
});
