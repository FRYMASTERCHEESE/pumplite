import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('metadata infrastructure health workflow is read-only and secret-free', async () => {
  const source =
    await readFile(
      '.github/workflows/metadata-health.yml',
      'utf8'
    );

  for (const required of [
    'name: Metadata infrastructure health',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'branches:',
    '- main',
    'permissions:',
    'contents: read',
    'persist-credentials: false',
    'PUMPLITE_METADATA_TIMEOUT_MS: "15000"',
    'pnpm verify:metadata-health'
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
