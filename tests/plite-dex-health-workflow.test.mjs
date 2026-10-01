import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PLITE DEX health workflow is read-only and bounded', async () => {
  const source =
    await readFile(
      '.github/workflows/plite-dex-health.yml',
      'utf8'
    );

  for (const required of [
    'name: PLITE DEX health',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'branches:',
    '- main',
    'permissions:',
    'contents: read',
    'persist-credentials: false',
    'PUMPLITE_DEX_LOG_BLOCK_SPAN: "20000"',
    'pnpm verify:plite-dex-health'
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
