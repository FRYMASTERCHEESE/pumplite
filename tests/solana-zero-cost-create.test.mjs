import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test(
  'Solana creator path is message-only and cannot submit a transaction',
  async () => {
    const adapter =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    const start =
      adapter.indexOf(
        'async createFreeDraft'
      );

    const end =
      adapter.indexOf(
        '\n    async create({',
        start
      );

    assert.ok(
      start >= 0 &&
      end > start,
      'Free launch method missing'
    );

    const free =
      adapter.slice(
        start,
        end
      );

    assert.match(
      free,
      /signMessage/
    );

    for (const forbidden of [
      'signTransaction',
      'sendRawTransaction',
      'send(',
      'SystemProgram.createAccount',
      'partialSign'
    ]) {
      assert.equal(
        free.includes(forbidden),
        false,
        'Free creator method must not contain transaction capability: ' +
          forbidden
      );
    }
  }
);

test(
  'Solana UI exits through free draft before paid create',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    assert.match(
      app,
      /createFreeDraft\(data\)/
    );

    assert.match(
      app,
      /Creator cost: 0 SOL/
    );

    assert.match(
      app,
      /No Solana transaction was submitted/
    );

    assert.match(
      app,
      /first buyer will fund on-chain activation/i
    );

    const branch =
      app.indexOf(
        "state.chain === 'solana'"
      );

    assert.ok(
      branch >= 0
    );
  }
);
