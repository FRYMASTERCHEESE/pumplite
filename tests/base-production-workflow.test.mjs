import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base production health workflow is read-only and runs the live verifier', async () => {
  const source =
    await readFile(
      '.github/workflows/base-production-health.yml',
      'utf8'
    );

  for (const required of [
    'name: Base production health',
    'workflow_dispatch:',
    'schedule:',
    'cron: "23 18 * * *"',
    'push:',
    'permissions:',
    'contents: read',
    'persist-credentials: false',
    'timeout-minutes: 15',
    'pnpm install --frozen-lockfile --ignore-scripts',
    'pnpm verify:base-production'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing workflow requirement: ' + required
    );
  }

  for (const protectedPath of [
    'config.json',
    'deployments/base-v2-mainnet.json',
    'contracts/base/v2/**',
    'contracts/base/claim/**',
    'scripts/verify-base-production.mjs',
    'web/plite-info.json',
    'web/verified-tokens.json'
  ]) {
    assert.ok(
      source.includes(protectedPath),
      'Missing relevant-push path: ' + protectedPath
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

  assert.doesNotMatch(
    source,
    /private[_ -]?key/i
  );

  assert.doesNotMatch(
    source,
    /\bdeploy\b/i
  );
});