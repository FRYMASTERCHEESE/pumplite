import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test(
  'Solana UI creates on-chain immediately with zero PumpLite creation fee',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    assert.match(
      app,
      /createdId = await adapter\.create\(data\);/
    );

    assert.match(
      app,
      /PumpLite creation fee is 0 SOL/
    );

    assert.match(
      app,
      /one-time Solana network\/account costs apply/i
    );

    assert.match(
      app,
      /No buyer is required/i
    );

    assert.doesNotMatch(
      app,
      /createFreeDraft\(data\)/
    );

    assert.doesNotMatch(
      app,
      /first buyer will fund on-chain activation/i
    );
  }
);

test(
  'direct Solana create builds and submits the real mint transaction',
  async () => {
    const adapter =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    const start =
      adapter.indexOf(
        'async create({'
      );

    const end =
      adapter.indexOf(
        '\n    async trade(',
        start
      );

    assert.ok(
      start >= 0 &&
      end > start,
      'Immediate Solana create method missing'
    );

    const create =
      adapter.slice(
        start,
        end
      );

    assert.match(
      create,
      /getMinimumBalanceForRentExemption/
    );

    assert.match(
      create,
      /buildTinyCreateInstructions/
    );

    assert.match(
      create,
      /await send\(/
    );

    assert.match(
      create,
      /built\.mintKeypair/
    );
  }
);

test(
  'public creation copy does not claim Solana network costs are zero',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    const html =
      await readFile(
        'index.html',
        'utf8'
      );

    assert.doesNotMatch(
      app,
      /pays no rent or network fee/i
    );

    assert.doesNotMatch(
      html,
      /pays no rent or network fee/i
    );

    assert.match(
      html,
      /one-time Solana network and account costs/i
    );

    assert.match(
      html,
      /No subscription, later PumpLite bill, sponsor, or buyer activation is required/i
    );
  }
);
