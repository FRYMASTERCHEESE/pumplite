import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Steps 131-400 expose exactly 270 static/local gates', async () => {
  const source =
    await readFile(
      'scripts/verify-hardening-131-400.mjs',
      'utf8'
    );

  const numbers = [
    ...source.matchAll(
      /\b(?:fileGate|okGate|incGate|workflowPinGate|workflowNoPrTargetGate)\(\s*(\d+)/g
    )
  ].map(match => Number(match[1]));

  assert.deepEqual(
    numbers,
    Array.from(
      { length: 270 },
      (_, index) => 131 + index
    )
  );

  for (const required of [
    'PASS - PRODUCTION HARDENING STEPS 131-400',
    '270 static/local gates passed.',
    'No network request made by this verifier.',
    'critical file present: package.json',
    'Base factory identity',
    'market five-minute deadline cap',
    'metadata authorization required',
    'pinned GitHub actions:',
    'supporting verification file present:',
    'previous hardening verifier reaches Step 130'
  ]) {
    assert.ok(
      source.includes(required),
      'Missing hardening marker: ' + required
    );
  }

  for (const forbidden of [
    'fetch(',
    'JsonRpcProvider',
    'BrowserProvider',
    'sendTransaction(',
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'new Wallet(',
    'privateKey =',
    'child_process',
    'execFileSync'
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      'Static hardening verifier must not gain network/transaction execution: ' +
        forbidden
    );
  }
});

test('Steps 131-400 workflow is pinned and read-only', async () => {
  const source =
    await readFile(
      '.github/workflows/hardening-131-400.yml',
      'utf8'
    );

  assert.match(
    source,
    /permissions:\s*\n\s*contents:\s*read/
  );

  assert.doesNotMatch(
    source,
    /pull_request_target\s*:/
  );

  assert.match(
    source,
    /node scripts\/verify-hardening-131-400\.mjs/
  );

  for (const line of source.split('\n')) {
    const match = line.match(/\buses:\s*([^\s#]+)/);
    if (!match) continue;
    const use = match[1];
    const at = use.lastIndexOf('@');
    assert.ok(at > 0);
    assert.match(use.slice(at + 1), /^[0-9a-f]{40}$/i);
  }
});
