import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('metadata infrastructure verifier probes public health and fail-closed gates without uploading', async () => {
  const source =
    await readFile(
      'scripts/verify-metadata-health.mjs',
      'utf8'
    );

  for (const required of [
    '/health',
    '/metadata/capabilities',
    '/metadata/image',
    '/metadata/json',
    '/metadata/challenge',
    '/metadata/issue',
    'Origin not allowed',
    'Upload authorization required',
    'Metadata authorization rejected',
    'PUMPLITE_METADATA_TIMEOUT_MS',
    'No wallet used. No signature requested. No upload performed. No transaction submitted.'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing metadata health coverage: ' +
        required
    );
  }

  for (const forbidden of [
    'BrowserProvider',
    'sendTransaction',
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'eth_requestAccounts',
    'personal_sign',
    'PINATA_JWT',
    'HELIUS_RPC_URL',
    'privateKey'
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      'Metadata health verifier must not contain: ' +
        forbidden
    );
  }
});
