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
    /assets\/claim\.js\?boot=[0-9A-Za-z_-]+/
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

  assert.doesNotMatch(
    source,
    /location\.assign\(phantomBrowseUrl\(\)\)/
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

test('claim boot never blocks Connect while read-only RPC initializes', async () => {
  const source = await readFile('web/claim.js', 'utf8');

  assert.match(
    source,
    /const configReady\s*=\s*Boolean\(config\?\.base\?\.holderClaim\)/
  );

  assert.match(
    source,
    /Wallet connection is ready\. Checking Base Mainnet/
  );

  assert.match(
    source,
    /The read-only RPC check must never block wallet connection/
  );

  assert.match(
    source,
    /if \(readProvider\)/
  );

  assert.match(
    source,
    /read-only Base RPC is temporarily unavailable/
  );

  assert.match(
    source,
    /boot\(\)\.catch/
  );

  assert.doesNotMatch(
    source,
    /withBusy\(boot\)/
  );

  assert.match(
    source,
    /PumpLite configuration is still loading\. Tap Connect Base wallet again in a moment/
  );
});

test('live claim config is the default when no contract query is supplied', async () => {
  const source = await readFile('web/claim.js', 'utf8');
  const html = await readFile('claim.html', 'utf8');
  const config = JSON.parse(
    await readFile('config.json', 'utf8')
  );

  assert.equal(
    config.base.holderClaim.enabled,
    true
  );

  assert.equal(
    config.base.holderClaim.contract,
    '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2'
  );

  assert.match(
    source,
    /config\?\.base\?\.holderClaim\?\.enabled === true/
  );

  assert.match(
    source,
    /urlValue \|\| configuredValue/
  );

  assert.match(
    html,
    /assets\/claim\.js\?boot=[0-9A-Za-z_-]+/
  );
});
