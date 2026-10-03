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

const PUMP =
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

const PUMP_AMM =
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

const MAYHEM =
  'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e';

function clone() {
  return structuredClone(
    current
  );
}

test(
  'production enables reviewed Base and Pump Mainnet',
  () => {
    validatePublicConfig(
      current
    );

    assert.equal(
      current.base.factory,
      '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4'
    );

    assert.equal(
      current.base.contractVersion,
      2
    );

    assert.equal(
      deploymentConfigured(
        current,
        'base'
      ),
      true
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
        'base'
      ),
      true
    );

    assert.equal(
      transactionConfigEnabled(
        current,
        'solana'
      ),
      true
    );

    assert.equal(
      current.solana.protocol,
      'pump'
    );

    assert.equal(
      current.solana.programId,
      PUMP
    );

    assert.equal(
      current.solana.ammProgramId,
      PUMP_AMM
    );

    assert.equal(
      current.solana.mayhemProgramId,
      MAYHEM
    );

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
      current.base.holderClaim.claimAmount,
      '1'
    );

    assert.equal(
      current.base.holderClaim.maxClaims,
      50
    );
  }
);

test(
  'Base remains usable when Solana writes are intentionally disabled',
  () => {
    const config =
      clone();

    config.base.factory =
      validFactory;

    config.base.transactionsEnabled =
      true;

    config.solana.transactionsEnabled =
      false;

    validatePublicConfig(
      config
    );

    assert.equal(
      transactionConfigEnabled(
        config,
        'base'
      ),
      true
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
  'Base enabled with no factory fails closed',
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

    assert.equal(
      transactionConfigEnabled(
        config,
        'base'
      ),
      false
    );
  }
);

test(
  'Solana enabled without reviewed Pump deployment fails closed',
  () => {
    const config =
      clone();

    config.solana.programId =
      null;

    assert.throws(
      () =>
        validatePublicConfig(
          config
        ),
      /Unreviewed Pump Mainnet/
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
  'reviewed Pump deployment may be configured but write-disabled',
  () => {
    const config =
      clone();

    config.solana.transactionsEnabled =
      false;

    validatePublicConfig(
      config
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
      false
    );
  }
);

test(
  'unreviewed Pump identities and RPC routing are rejected',
  () => {
    for (
      const mutate of [
        config =>
          config.solana.programId =
            '11111111111111111111111111111111',
        config =>
          config.solana.ammProgramId =
            '11111111111111111111111111111111',
        config =>
          config.solana.mayhemProgramId =
            '11111111111111111111111111111111',
        config =>
          config.solana.rpcFallbackUrls =
            ['https://example.com']
      ]
    ) {
      const config =
        clone();

      mutate(config);

      assert.throws(
        () =>
          validatePublicConfig(
            config
          ),
        /Unreviewed Pump Mainnet/
      );
    }
  }
);

test(
  'wrong Base chain ID is rejected',
  () => {
    const config =
      clone();

    config.base.chainId = 1;

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
  'invalid and zero Base factories are rejected',
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
  'invalid and zero Base treasuries are rejected',
  () => {
    for (
      const treasury of [
        '0x0000000000000000000000000000000000000000',
        'not-an-address'
      ]
    ) {
      const config =
        clone();

      config.base.treasury =
        treasury;

      assert.throws(
        () =>
          validatePublicConfig(
            config
          ),
        /treasury/
      );
    }
  }
);

test(
  'enabled holder claim fails closed on bad addresses or limits',
  () => {
    for (
      const [field, value] of [
        [
          'contract',
          '0x0000000000000000000000000000000000000000'
        ],
        [
          'token',
          'not-an-address'
        ]
      ]
    ) {
      const config =
        clone();

      config.base.holderClaim[field] =
        value;

      assert.throws(
        () =>
          validatePublicConfig(
            config
          ),
        /holder claim address/
      );
    }

    {
      const config =
        clone();

      config.base.holderClaim.claimAmount =
        '0';

      assert.throws(
        () =>
          validatePublicConfig(
            config
          ),
        /holder claim amount/
      );
    }

    {
      const config =
        clone();

      config.base.holderClaim.maxClaims =
        0;

      assert.throws(
        () =>
          validatePublicConfig(
            config
          ),
        /holder claim maximum/
      );
    }
  }
);
