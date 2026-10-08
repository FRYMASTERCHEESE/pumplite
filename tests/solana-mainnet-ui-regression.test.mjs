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
  'new Solana creation routes straight to its on-chain mint',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    assert.ok(
      /\} else \{\s*createdId\s*=\s*await adapter\.create\(\s*data\s*\);/.test(app)
    );

    assert.ok(
      app.includes(
        'Coin created on Solana Mainnet. No buyer was required.'
      )
    );

    assert.ok(
      app.includes(
        'location.hash = routeHash;'
      )
    );

    assert.equal(
      app.includes(
        'createFreeDraft(data)'
      ),
      true
    );
  }
);
