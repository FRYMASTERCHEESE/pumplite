import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Steps 19-27 hardening verifier covers all nine production gates and stays read-only', async () => {
  const source =
    await readFile(
      'scripts/verify-hardening-19-27.mjs',
      'utf8'
    );

  for (const required of [
    "pass(\n    19,",
    "pass(\n    20,",
    "pass(\n    21,",
    "pass(\n    22,",
    "pass(\n    23,",
    "pass(\n    24,",
    "pass(\n    25,",
    "pass(\n    26,",
    "pass(\n    27,",
    'Claimed',
    'remainingClaims',
    'production identity seal',
    'wallet/provider safety boundary',
    'CI action pinning',
    'dependency version and lockfile discipline',
    'legal and risk-page integrity',
    'production monitoring mesh completeness',
    'live public critical-file parity',
    'No wallet used. No signature requested. No transaction submitted. No ETH spent.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing hardening coverage: ' +
        required
    );
  }

  for (const forbidden of [
    'BrowserProvider',
    'sendTransaction',
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'privateKey'
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      'Hardening verifier must not contain active transaction capability: ' +
        forbidden
    );
  }
});
