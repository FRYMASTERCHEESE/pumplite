import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base economic health workflow is read-only and bounded', async () => {
  const source =
    await readFile(
      '.github/workflows/base-economic-health.yml',
      'utf8'
    );

  for (const required of [
    'name: Base economic health',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'branches:',
    '- main',
    'permissions:',
    'contents: read',
    'persist-credentials: false',
    'PUMPLITE_MAX_MARKETS: "250"',
    'pnpm verify:base-economic-health'
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
