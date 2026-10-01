import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Steps 28-50 verifier exposes every hardening gate and remains static/read-only', async () => {
  const source = await readFile('scripts/verify-hardening-28-50.mjs', 'utf8');

  for (let step = 28; step <= 50; step++) {
    assert.ok(
      source.includes('pass(' + step + ',') ||
      source.includes('pass(\n    ' + step + ','),
      'Missing hardening step ' + step
    );
  }

  for (const required of [
    'public configuration schema and platform fee',
    'active Base V2 deployment identity',
    'Solana deployment lock',
    'First 50 claim public configuration',
    'PLITE public identity consistency',
    'reviewed PLITE registry integrity',
    'PLITE external DEX identity',
    'Base RPC redundancy configuration',
    'Base V2 economic constants',
    'slippage deadline and reentrancy guards',
    'market-only token authority and lifetime cap',
    'passive EVM wallet discovery',
    'mobile wallet handoff URL hygiene',
    'security header source policy',
    'workflow permissions and pinned action supply chain',
    'production monitoring and release-readiness mesh',
    'Static/local verification only. No wallet used. No signature requested. No transaction submitted. No ETH spent.'
  ]) {
    assert.ok(source.includes(required), 'Missing hardening marker: ' + required);
  }

  for (const forbidden of [
    'BrowserProvider(',
    'sendTransaction(',
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'privateKey =',
    'new Wallet('
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      'Static hardening verifier must not gain transaction capability: ' + forbidden
    );
  }
});
