import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public-site health workflow is read-only and retries while Pages catches up', async () => {
  const source =
    await readFile(
      '.github/workflows/public-site-health.yml',
      'utf8'
    );

  for (const required of [
    'name: Public site health',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'branches:',
    '- main',
    'permissions:',
    'contents: read',
    'persist-credentials: false',
    'PUMPLITE_SITE_VERIFY_ATTEMPTS: "24"',
    'PUMPLITE_SITE_VERIFY_DELAY_MS: "15000"',
    'node scripts/verify-public-site.mjs'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing workflow requirement: ' + required
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
