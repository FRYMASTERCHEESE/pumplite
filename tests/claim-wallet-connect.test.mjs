import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('claim Connect is a real Phantom universal link with injected-wallet interception', async () => {
  const source = await readFile('web/claim.js', 'utf8');
  const html = await readFile('claim.html', 'utf8');

  assert.match(
    html,
    /<a id="claim-connect"[^>]+https:\/\/phantom\.app\/ul\/browse\//
  );

  assert.match(
    html,
    />Connect Base wallet<\/a>/
  );

  assert.match(
    html,
    /On mobile, Connect opens this exact claim page inside Phantom/
  );

  assert.match(
    html,
    /assets\/claim\.js\?boot=20261002c/
  );

  assert.match(
    source,
    /function pickBaseProvider\(\)/
  );

  assert.match(
    source,
    /window\.phantom\?\.ethereum/
  );

  assert.match(
    source,
    /\$\('claim-connect'\)\.href\s*=\s*phantomBrowseUrl\(\)/
  );

  assert.match(
    source,
    /event\.preventDefault\(\)/
  );

  assert.match(
    source,
    /Do NOT preventDefault here/
  );

  assert.doesNotMatch(
    source,
    /location\.assign\(phantomBrowseUrl\(\)\)/
  );

  assert.doesNotMatch(
    source,
    /await new Promise\(\(\) => \{\}\)/
  );

  assert.match(
    source,
    /Requesting Base wallet access/
  );

  assert.match(
    source,
    /Base wallet connected:/
  );
});
