import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base RPC redundancy workflow is read-only and bounded', async () => {
  const source =
    await readFile(
      '.github/workflows/base-rpc-health.yml',
      'utf8'
    );

  for (const required of [
    'name: Base RPC redundancy',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'branches:',
    '- main',
    'permissions:',
    'contents: read',
    'persist-credentials: false',
    'PUMPLITE_RPC_MAX_BLOCK_LAG: "300"',
    'PUMPLITE_RPC_MAX_STALE_SECONDS: "900"',
    'pnpm verify:base-rpc-health'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing workflow requirement: ' +
        required
    );
  }

  assert.doesNotMatch(
    source,
    /contents:\s*write/
  );

  assert.doesNotMatch(
    source,
    /secrets\./
  );

  assert.doesNotMatch(
    source,
    /eth_send(?:Raw)?Transaction/
  );
});
