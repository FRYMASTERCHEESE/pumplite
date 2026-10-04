import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';
import {
  existsSync
} from 'node:fs';

test(
  'retired Pump compatibility files stay absent and tiny owns the reviewed write path',
  async () => {
    const config =
      JSON.parse(
        await readFile(
          'config.json',
          'utf8'
        )
      );

    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    const tiny =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    const worker =
      await readFile(
        'workers/pumplite-rpc/worker.js',
        'utf8'
      );

    assert.equal(
      config.solana.protocol,
      'tiny'
    );

    assert.equal(
      config.solana.transactionsEnabled,
      true
    );

    assert.match(
      app,
      /adapters\/solana-tiny\.js/
    );

    assert.doesNotMatch(
      app,
      /solana-pump(?:-loader)?\.js/
    );

    assert.equal(
      existsSync(
        'web/adapters/solana-pump.js'
      ),
      false,
      'Retired Pump adapter must stay deleted'
    );

    assert.equal(
      existsSync(
        'web/adapters/solana-pump-loader.js'
      ),
      false,
      'Retired Pump loader must stay deleted'
    );

    for (
      const pattern of [
        /const\s+writeConnection\s*=/,
        /async\s+function\s+writeNetwork\s*\(/,
        /writeConnection[\s\S]*getGenesisHash/,
        /writeConnection[\s\S]*getLatestBlockhash/,
        /simulateTransaction/,
        /sendRawTransaction/,
        /confirmTransaction/
      ]
    ) {
      assert.match(
        tiny,
        pattern
      );
    }

    assert.doesNotMatch(
      worker,
      /^\s*"sendTransaction",?\s*$/m
    );

    assert.doesNotMatch(
      worker,
      /^\s*"sendRawTransaction",?\s*$/m
    );

    assert.match(
      worker,
      /"simulateTransaction"/
    );
  }
);
