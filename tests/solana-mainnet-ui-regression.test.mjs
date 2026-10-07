import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';

test(
  'Solana first-buyer UI is live and not stale-locked',
  async () => {
    const ui =
      await readFile(
        'web/solana-launch-ui.js',
        'utf8'
      );

    assert.ok(
      ui.includes(
        'Buy amount (SOL)'
      )
    );

    assert.ok(
      ui.includes(
        'activateReservedFirstBuyer'
      )
    );

    assert.ok(
      ui.includes(
        'retryFinalizeFirstBuyer'
      )
    );

    assert.ok(
      ui.includes(
        '0.25% trading fee'
      )
    );

    assert.equal(
      /final release checks/i.test(ui),
      false
    );

    assert.equal(
      /final spend-review unlock/i.test(ui),
      false
    );
  }
);

test(
  'activation remembers buyer for registry finalization',
  async () => {
    const source =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    const start =
      source.indexOf(
        'local.submitted = {'
      );

    assert.ok(
      start >= 0
    );

    const block =
      source.slice(
        start,
        start + 500
      );

    assert.match(
      block,
      /buyer:\s*buyer\.toBase58\(\)/
    );
  }
);

test(
  'simple buy supports activated Solana tiny markets',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    assert.ok(
      app.includes(
        'function simpleBuySupported()'
      )
    );

    assert.ok(
      app.includes(
        'function tradeNative()'
      )
    );

    assert.ok(
      app.includes(
        'Connect Phantom before buying on Solana'
      )
    );

    assert.ok(
      app.includes(
        'await active.quote('
      )
    );

    assert.equal(
      app.includes(
        'Simple buy is available for Base V2 markets'
      ),
      false
    );
  }
);

test(
  'trade UI has dynamic SOL and ETH labels',
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

    assert.ok(
      app.includes(
        "state.chain === 'solana'"
      )
    );

    assert.ok(
      app.includes(
        "'SOL'"
      )
    );

    assert.ok(
      app.includes(
        "'Base ETH'"
      )
    );

    assert.ok(
      html.includes(
        'id="quote-output-label"'
      )
    );

    assert.ok(
      html.includes(
        'id="quote-min-label"'
      )
    );

    assert.ok(
      html.includes(
        'id="trade-quick-buy-copy"'
      )
    );
  }
);

test(
  'free Solana creation opens Markets after publishing',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    const start =
      app.indexOf(
        'Free PumpLite coin signed and published'
      );

    assert.ok(
      start >= 0
    );

    const flow =
      app.slice(
        start,
        start + 2200
      );

    assert.ok(
      flow.includes(
        'showHomePage('
      )
    );

    assert.ok(
      flow.includes(
        "'markets'"
      )
    );

    assert.ok(
      flow.includes(
        'await discover('
      )
    );
  }
);