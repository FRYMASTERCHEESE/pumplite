import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';

test(
  'reserved first-buyer activation is fail-closed and browser-local',
  async () => {
    const config =
      JSON.parse(
        await readFile(
          'config.json',
          'utf8'
        )
      );

    assert.equal(
      config.solana.transactionsEnabled,
      true
    );

    const source =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    const start =
      source.indexOf(
        'async activateReservedFirstBuyer'
      );

    const end =
      source.indexOf(
        '\n    async create({',
        start
      );

    assert.ok(
      start >= 0 &&
      end > start
    );

    const method =
      source.slice(
        start,
        end
      );

    assert.match(
      method,
      /config\.transactionsEnabled/
    );

    assert.match(
      method,
      /buildTinyFirstBuyerActivationInstructions/
    );

    assert.match(
      method,
      /local\.mintKeypair/
    );

    assert.match(
      method,
      /await send/
    );

    assert.match(
      method,
      /\/launch\//
    );

    assert.match(
      method,
      /treasury wallet cannot be the first buyer/
    );

    assert.doesNotMatch(
      method,
      /fromSecretKey/
    );

    assert.doesNotMatch(
      method,
      /secretKey/
    );
  }
);

test(
  'server still contains no mint Keypair reconstruction',
  async () => {
    const source =
      await readFile(
        'workers/pumplite-upload-guard/src/launches.js',
        'utf8'
      );

    for (const forbidden of [
      /Keypair/,
      /fromSecretKey/,
      /secretKey/,
      /mint_secret/,
      /mintSecret/
    ]) {
      assert.doesNotMatch(
        source,
        forbidden
      );
    }

    assert.match(
      source,
      /DELETE FROM solana_launch_reservations/
    );
  }
);
