import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Steps 19-27 hardening verifier covers all nine production gates and stays read-only', async () => {
  const source =
    (
      await readFile(
        'scripts/verify-hardening-19-27.mjs',
        'utf8'
      )
    ).replace(
      /\r\n?/g,
      '\n'
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

test('Archive RPC monitoring supports private HTTPS endpoints, redacts them, and remains fail-closed', async () => {
  const source = await readFile('scripts/verify-hardening-19-27.mjs', 'utf8');
  const workflow = await readFile('.github/workflows/hardening-19-27.yml', 'utf8');

  assert.match(workflow, /PUMPLITE_HARDENING_ARCHIVE_RPC_URL:\s*\$\{\{ secrets\.PUMPLITE_HARDENING_ARCHIVE_RPC_URL \}\}/);
  assert.match(source, /archiveRpcUrl \? \[archiveRpcUrl\] : \[\]/);
  assert.match(source, /assert\.equal\(parsed\.protocol, 'https:'/);
  assert.match(source, /configured archive RPC \(address hidden\)/);
  assert.match(source, /rpcDisplayName\(rpcUrl\)/);
  assert.match(source, /rpcFailureMessage\(error, rpcUrl\)/);
  assert.match(source, /assertionError \?\?= error/);
  assert.match(source, /Historical Base claim verification BLOCKED/);

  assert.doesNotMatch(source, /'Claim RPC:',\s*rpcUrl/);
  assert.doesNotMatch(source, /'Skipping unavailable claim RPC '\s*\+\s*rpcUrl/);
  assert.doesNotMatch(source, /'Claim hardening attempt failed through '\s*\+\s*rpcUrl/);
});
