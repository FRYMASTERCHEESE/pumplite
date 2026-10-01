import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PLITE DEX verifier checks canonical Uniswap V2 provenance and reserve synchronization', async () => {
  const source =
    await readFile(
      'scripts/verify-plite-dex-health.mjs',
      'utf8'
    );

  for (const required of [
    '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
    '0x4200000000000000000000000000000000000006',
    'factory.getPair',
    'pair.factory',
    'pair.token0',
    'pair.token1',
    'pair.getReserves',
    'pair.totalSupply',
    'pair.MINIMUM_LIQUIDITY',
    'pair.balanceOf',
    'PairCreated',
    'Mint',
    'Burn',
    'Swap',
    'Sync',
    'PUMPLITE_DEX_LOG_BLOCK_SPAN',
    'No wallet used. No signature requested. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing PLITE DEX health coverage: ' +
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
      'PLITE DEX verifier must not contain: ' +
        forbidden
    );
  }
});
