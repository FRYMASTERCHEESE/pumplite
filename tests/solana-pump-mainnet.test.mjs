import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readFile
} from 'node:fs/promises';

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
  'Pump Mainnet programs are pinned',
  () => {
    validatePublicConfig(config);

    assert.equal(
      config.solana.protocol,
      'pump'
    );

    assert.equal(
      config.solana.programId,
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
    );

    assert.equal(
      config.solana.ammProgramId,
      'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
    );

    assert.equal(
      config.solana.mayhemProgramId,
      'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e'
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
  'frontend selects Pump Mainnet adapter',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    assert.match(
      app,
      /adapters\/solana-pump-loader\.js/
    );

    assert.doesNotMatch(
      app,
      /await import\('\.\/adapters\/solana-tiny\.js'\)/
    );

    assert.match(
      app,
      /solana-mayhem/
    );
  }
);

test(
  'Pump adapter contains reviewed wallet safety path',
  async () => {
    const source =
      await readFile(
        'web/adapters/solana-pump.js',
        'utf8'
      );

    assert.match(
      source,
      /@pump-fun\/pump-sdk/
    );

    assert.match(
      source,
      /@pump-fun\/pump-swap-sdk/
    );

    assert.match(
      source,
      /createV2Instruction/
    );

    assert.match(
      source,
      /buyInstructions/
    );

    assert.match(
      source,
      /sellInstructions/
    );

    assert.match(
      source,
      /buyQuoteInput/
    );

    assert.match(
      source,
      /sellBaseInput/
    );

    assert.match(
      source,
      /simulateTransaction/
    );

    assert.match(
      source,
      /signTransaction/
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

test(
  'Pump browser startup remains lazy and preloaded',
  async () => {
    const adapter =
      await readFile(
        'web/adapters/solana-pump.js',
        'utf8'
      );

    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    assert.match(
      adapter,
      /function ensureSdk\(\)/
    );

    assert.doesNotMatch(
      adapter,
      /let pump\s*=\s*new OnlinePumpSdk/
    );

    assert.doesNotMatch(
      adapter,
      /let amm\s*=\s*new OnlinePumpAmmSdk/
    );

    assert.match(
      app,
      /state\.chain === 'solana'[\s\S]*?await getAdapter\(\)/
    );
  }
);


test(
  'wallet app readiness is not blocked by Pump adapter preload',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    const ready =
      app.indexOf(
        "document.documentElement.dataset.walletAppReady"
      );

    const preload =
      app.indexOf(
        "document.documentElement.dataset.pumpAdapterReady"
      );

    assert.ok(
      ready >= 0
    );

    assert.ok(
      preload > ready,
      'Pump preload must happen only after walletAppReady'
    );

    assert.match(
      app,
      /queueMicrotask\(/
    );
  }
);


test(
  'Solana-only Buffer loader initializes before Pump SDK',
  async () => {
    const loader =
      await readFile(
        'web/adapters/solana-pump-loader.js',
        'utf8'
      );

    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    assert.match(
      loader,
      /globalThis\.Buffer/
    );

    assert.match(
      loader,
      /BrowserBuffer\.from/
    );

    const globalIndex =
      loader.indexOf(
        'globalThis.Buffer'
      );

    const pumpIndex =
      loader.indexOf(
        "await import("
      );

    assert.ok(
      globalIndex >= 0 &&
      pumpIndex > globalIndex,
      'Buffer must initialize before Pump import'
    );

    assert.match(
      app,
      /solana-pump-loader\.js/
    );
  }
);
