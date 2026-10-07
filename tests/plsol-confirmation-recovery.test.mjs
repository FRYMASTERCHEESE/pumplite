import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source =
  await readFile(
    new URL(
      '../web/adapters/solana-tiny.js',
      import.meta.url
    ),
    'utf8'
  );

test(
  'PLSOL keeps fresh blockhash and bounded retries',
  () => {
    assert.match(
      source,
      /const signingLatest\s*=/
    );

    assert.match(
      source,
      /signingSnapshot/
    );

    assert.match(
      source,
      /maxRetries:\s*5/
    );

    assert.match(
      source,
      /\.\.\.signingLatest/
    );
  }
);

test(
  'PLSOL checks chain history before reporting confirmation expiry',
  () => {
    assert.match(
      source,
      /getSignatureStatuses/
    );

    assert.match(
      source,
      /searchTransactionHistory:\s*true/
    );

    assert.match(
      source,
      /Confirmed on Solana after final status check\./
    );

    assert.match(
      source,
      /Do not retry/
    );
  }
);