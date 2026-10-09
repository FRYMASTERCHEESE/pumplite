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

test(
  'activated MAYM market is a distinct identity from a duplicate pending launch',
  async () => {
    const { matchingActivatedMarket } =
      await import('../web/solana-launch-ui.js');

    const creator =
      'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct';
    const pending = {
      id: '03bb9c350ff1f224a79dcbc7f134a64420fe049cd8f9dee8d96527ae2adcdd2f',
      creator,
      name: 'Mayhem Monday',
      symbol: 'MAYM',
      status: 'pending'
    };
    const activated = {
      id: 'FEofu2h5RY4yyuoZJKT4VhwWqJ78ScEy6WjoFCyQ1Xqe',
      creator,
      name: 'Mayhem Monday',
      symbol: 'MAYM'
    };

    assert.equal(
      matchingActivatedMarket(pending, [activated])?.id,
      activated.id
    );
    assert.equal(pending.status, 'pending');
    assert.equal(
      matchingActivatedMarket(
        {...pending, creator: 'another-wallet'},
        [activated]
      ),
      null
    );
    assert.equal(
      matchingActivatedMarket(
        {...pending, symbol: 'PLSOL'},
        [activated]
      ),
      null
    );
    assert.equal(
      matchingActivatedMarket(
        pending,
        [activated, {...activated, id: 'A'.repeat(44)}]
      ),
      null,
      'ambiguous same-name markets must not be guessed'
    );

    const ui = await readFile('web/solana-launch-ui.js', 'utf8');
    const app = await readFile('web/app.js', 'utf8');
    assert.match(app, /activatedMarkets:\s*state\.markets/);
    assert.match(ui, /SEPARATE PENDING LISTING/);
    assert.match(ui, /Do not pay again to activate your existing coin/);
    assert.match(ui, /matchingActivatedMarket\([\s\S]*?\)\s*:\s*null;/);
  }
);

test(
  'Solana recent trades use market native currency instead of hardcoded ETH',
  async () => {
    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    const start =
      app.indexOf(
        'function renderRecentTrades(market)'
      );
    const end =
      app.indexOf(
        '\nlet pliteDexStatsRequest',
        start
      );
    assert.ok(start >= 0 && end > start);

    const recentTrades =
      app.slice(start, end);
    assert.match(
      recentTrades,
      /' ' \+ market\.unit \+ ' \/ '/
    );
    assert.doesNotMatch(
      recentTrades,
      /' ETH \/ '/
    );
    assert.match(
      recentTrades,
      /'Solana slot '/
    );
  }
);
