import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  parseUnits,
  minimumOutput
} from '../web/math.js';

test(
  'buy UX has no PumpLite hardcoded positive minimum',
  async () => {
    assert.equal(
      parseUnits(
        '0.000000000000000001',
        18
      ),
      1n
    );

    assert.equal(
      minimumOutput(1n, 100),
      1n
    );

    const html =
      await readFile(
        'index.html',
        'utf8'
      );

    const amount =
      html.match(
        /<input id="amount"[^>]*>/
      )?.[0];

    assert.ok(amount);
    assert.doesNotMatch(
      amount,
      /\smin=/
    );

    assert.match(
      html,
      /No PumpLite minimum/
    );
  }
);

test(
  'market UX exposes bounded real-trade chart, Mayhem timing and owner review',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    const adapter =
      await readFile(
        'web/adapters/base-v2.js',
        'utf8'
      );

    const html =
      await readFile(
        'index.html',
        'utf8'
      );

    const chart =
      await readFile(
        'web/price-chart.js',
        'utf8'
      );

    const styles =
      await readFile(
        'web/styles.css',
        'utf8'
      );

    assert.match(
      app,
      /refreshMarketAfterAction/
    );

    assert.match(
      app,
      /mayhemManualReady/
    );

    assert.match(
      app,
      /loadMarketChart/
    );

    assert.match(
      adapter,
      /async tradeHistory/
    );

    assert.match(
      adapter,
      /chunk < 20/
    );

    assert.match(
      adapter,
      /let logWindow = 999/
    );

    assert.match(
      adapter,
      /HTTP 413/
    );

    assert.match(
      adapter,
      /Math\.floor\(logWindow \/ 2\)/
    );

    assert.match(
      adapter,
      /Manual Mayhem unlocks 24 hours/
    );

    assert.match(
      html,
      /price-chart/
    );

    assert.match(
      html,
      /id="simple-buy-output"/
    );

    assert.match(
      html,
      /NZD \(NZ\$\)/
    );

    assert.match(
      html,
      /USD \(US\$\)/
    );

    assert.match(
      app,
      /formatSimpleTokenAmount/
    );

    assert.match(
      app,
      /minimumOutput\(q\.output, 100\)/
    );

    assert.match(
      app,
      /await connectBaseWalletFromGesture\(\)/
    );

    assert.match(
      html,
      /owner-review-panel/
    );

    assert.match(
      html,
      /portable Base verification/
    );

    assert.match(
      html,
      /Publish Verified attestation/
    );

    assert.match(
      chart,
      /trend-line/
    );

    assert.match(
      chart,
      /trend-area/
    );

    assert.match(
      chart,
      /trend-' \+ direction/
    );

    assert.match(
      styles,
      /\.trend-up/
    );

    assert.match(
      styles,
      /\.trend-down/
    );
  }
);

test(
  'build accepts safe cache-bust versions instead of one hardcoded release id',
  async () => {
    const build =
      await readFile(
        'scripts/build.mjs',
        'utf8'
      );

    assert.match(
      build,
      /\[0-9A-Za-z_-\]\+/
    );

    assert.doesNotMatch(
      build,
      /html\.includes\('src="\.\/assets\/app\.js\?boot=20260929c"'\)/
    );
  }
);
