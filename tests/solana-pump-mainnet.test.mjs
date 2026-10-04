import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  deploymentConfigured,
  transactionConfigEnabled,
  validatePublicConfig
} from '../web/release-config.js';

const config =
  JSON.parse(
    await readFile(
      'config.json',
      'utf8'
    )
  );

test(
  'PumpLite Solana Mainnet identity is pinned',
  () => {
    validatePublicConfig(
      config
    );

    assert.equal(
      config.solana.protocol,
      'tiny'
    );

    assert.equal(
      config.solana.clientVersion,
      5
    );

    assert.equal(
      config.solana.programId,
      '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'
    );

    assert.equal(
      config.solana.treasury,
      'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'
    );

    assert.equal(
      deploymentConfigured(
        config,
        'solana'
      ),
      true
    );

    assert.equal(
      transactionConfigEnabled(
        config,
        'solana'
      ),
      true
    );
  }
);

test(
  'frontend selects PumpLite tiny adapter',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    assert.match(
      app,
      /protocol === 'tiny'/
    );

    assert.match(
      app,
      /adapters\/solana-tiny\.js/
    );
  }
);

test(
  'PumpLite adapter has reviewed Phantom safety path',
  async () => {
    const source =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    assert.match(
      source,
      /ComputeBudget111111111111111111111111111111/
    );

    assert.match(
      source,
      /simulateTransaction/
    );

    assert.match(
      source,
      /fee\.value > 200_000/
    );

    assert.match(
      source,
      /Wallet changed a PumpLite instruction/
    );

    assert.doesNotMatch(
      source,
      /secretKey|fromSecretKey/
    );
  }
);

test(
  'Base Mainnet remains unchanged',
  () => {
    assert.equal(
      config.base.factory
        .toLowerCase(),
      '0xda8c34819ae397fd4be3c95947dea64f4a3278f4'
    );

    assert.equal(
      config.base.contractVersion,
      2
    );

    assert.equal(
      config.base.transactionsEnabled,
      true
    );
  }
);
