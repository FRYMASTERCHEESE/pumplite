import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  validatePublicConfig,
  deploymentConfigured,
  transactionConfigEnabled
} from '../web/release-config.js';

const current =
  JSON.parse(
    await readFile(
      'config.json',
      'utf8'
    )
  );

const validFactory =
  '0x1111111111111111111111111111111111111111';

function clone() {
  return structuredClone(
    current
  );
}

test(
  'production pins Base and PumpLite Mainnet',
  () => {
    validatePublicConfig(
      current
    );

    assert.equal(
      current.solana.protocol,
      'tiny'
    );

    assert.equal(
      current.solana.programId,
      '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'
    );

    assert.equal(
      current.solana.treasury,
      'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'
    );

    assert.equal(
      current.solana.transactionsEnabled,
      false
    );

    assert.equal(
      deploymentConfigured(
        current,
        'solana'
      ),
      true
    );

    assert.equal(
      transactionConfigEnabled(
        current,
        'solana'
      ),
      false
    );

    assert.equal(
      deploymentConfigured(
        current,
        'base'
      ),
      true
    );

    assert.equal(
      transactionConfigEnabled(
        current,
        'base'
      ),
      true
    );
  }
);

test(
  'reviewed PumpLite config can enable writes explicitly',
  () => {
    const config =
      clone();

    config.solana
      .transactionsEnabled =
      true;

    validatePublicConfig(
      config
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
  'missing PumpLite program fails closed when writes enabled',
  () => {
    const config =
      clone();

    config.solana
      .transactionsEnabled =
      true;

    config.solana.programId =
      null;

    assert.throws(
      () =>
        validatePublicConfig(
          config
        ),
      /PumpLite Mainnet/
    );

    assert.equal(
      transactionConfigEnabled(
        config,
        'solana'
      ),
      false
    );
  }
);

test(
  'unreviewed PumpLite identities are rejected',
  () => {
    const changes = [
      config =>
        config.solana.programId =
          '11111111111111111111111111111111',

      config =>
        config.solana.treasury =
          '11111111111111111111111111111111',

      config =>
        config.solana.clientVersion =
          4,

      config =>
        config.solana.rpcFallbackUrls =
          ['https://example.com']
    ];

    for (const mutate of changes) {
      const config =
        clone();

      mutate(config);

      assert.throws(
        () =>
          validatePublicConfig(
            config
          ),
        /PumpLite Mainnet/
      );

      assert.equal(
        deploymentConfigured(
          config,
          'solana'
        ),
        false
      );
    }
  }
);

test(
  'Base enabled without factory fails closed',
  () => {
    const config =
      clone();

    config.base.factory =
      null;

    assert.throws(
      () =>
        validatePublicConfig(
          config
        ),
      /without a deployed factory/
    );
  }
);

test(
  'wrong Base chain ID is rejected',
  () => {
    const config =
      clone();

    config.base.chainId =
      1;

    assert.throws(
      () =>
        validatePublicConfig(
          config
        ),
      /Base chain/
    );
  }
);

test(
  'invalid Base factories are rejected',
  () => {
    for (
      const factory of [
        '0x0000000000000000000000000000000000000000',
        'not-an-address'
      ]
    ) {
      const config =
        clone();

      config.base.factory =
        factory;

      assert.throws(
        () =>
          validatePublicConfig(
            config
          ),
        /factory/
      );
    }
  }
);

test(
  'legacy global transaction switch is rejected',
  () => {
    const config =
      clone();

    config.transactionsEnabled =
      true;

    assert.throws(
      () =>
        validatePublicConfig(
          config
        ),
      /global transaction switch/
    );
  }
);

test(
  'Base holder claim remains pinned',
  () => {
    assert.equal(
      current.base.holderClaim.enabled,
      true
    );

    assert.equal(
      current.base.holderClaim.contract,
      '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2'
    );

    assert.equal(
      current.base.holderClaim.token,
      '0xb15A460142c77b42cDF57815b0eeFEb24b593196'
    );

    assert.equal(
      current.base.holderClaim.maxClaims,
      50
    );
  }
);
