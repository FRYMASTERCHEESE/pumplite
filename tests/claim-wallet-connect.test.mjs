import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('claim Connect button supports Phantom Base and mobile handoff', async () => {
  const source = await readFile('web/claim.js', 'utf8');
  const html = await readFile('claim.html', 'utf8');

  assert.match(
    source,
    /window\.phantom\?\.ethereum/
  );

  assert.match(
    source,
    /https:\/\/phantom\.app\/ul\/browse\//
  );

  assert.match(
    source,
    /location\.assign\(phantomBrowseUrl\(\)\)/
  );

  assert.match(
    source,
    /No Base wallet is available in this browser\. Opening this exact claim page inside Phantom/
  );

  assert.match(
    source,
    /Requesting Base wallet access/
  );

  assert.match(
    source,
    /Base wallet connected:/
  );

  assert.match(
    html,
    /id="claim-connect"[^>]*>Connect Base wallet<\/button>/
  );

  assert.match(
    html,
    /assets\/claim\.js\?boot=20261002b/
  );
});
