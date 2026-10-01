import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Base trade provenance workflow is read-only and bounded', async () => {
  const source =
    await readFile(
      '.github/workflows/base-trade-provenance.yml',
      'utf8'
    );

  for (const required of [
    'name: Base trade provenance',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'branches:',
    '- main',
    'permissions:',
    'contents: read',
    'persist-credentials: false',
    'PUMPLITE_MAX_MARKETS: "250"',
    'PUMPLITE_TRADE_LOG_BLOCK_SPAN: "20000"',
    'pnpm verify:base-trade-provenance'
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
