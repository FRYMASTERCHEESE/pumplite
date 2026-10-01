import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');

const FACTORY =
  '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4';

const PAIR =
  '0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086';

test(
  'current documentation names the active Base V2 deployment',
  async () => {
    const [
      readme,
      status,
      security,
      market,
      verification
    ] =
      await Promise.all([
        read('README.md'),
        read('docs/CURRENT_STATUS.md'),
        read('docs/SECURITY.md'),
        read('docs/PLITE_MARKET_DATA.md'),
        read('docs/TOKEN_VERIFICATION.md')
      ]);

    for (const text of [
      readme,
      status,
      security,
      market,
      verification
    ]) {
      assert.ok(
        text.toLowerCase().includes(
          FACTORY.toLowerCase()
        )
      );
    }

    assert.ok(
      status.toLowerCase().includes(
        PAIR.toLowerCase()
      )
    );

    assert.ok(
      market.toLowerCase().includes(
        PAIR.toLowerCase()
      )
    );

    assert.ok(
      status.includes(
        'transactionsEnabled=false'
      )
    );
  }
);

test(
  'README no longer publishes obsolete pre-live statements',
  async () => {
    const readme =
      await read('README.md');

    assert.equal(
      readme.includes(
        'No wallet signing flow was exercised against Mainnet.'
      ),
      false
    );

    assert.equal(
      readme.includes(
        'GitHub-hosted workflow has not been run.'
      ),
      false
    );

    assert.equal(
      readme.includes(
        'There is no continuous chart/history service, external price feed, automatic polling, image upload, or custodial backend.'
      ),
      false
    );

    assert.ok(
      readme.includes(
        'PLITE/WETH Uniswap V2 liquidity position'
      )
    );

    assert.ok(
      readme.includes(
        'docs/CURRENT_STATUS.md'
      )
    );
  }
);

test(
  'security docs expose the V2 mintable privilege and audit boundary',
  async () => {
    const security =
      await read('docs/SECURITY.md');

    assert.ok(
      security.toLowerCase().includes(
        'mintable'
      )
    );

    assert.ok(
      security.includes(
        'immutable lifetime maximum'
      )
    );

    assert.ok(
      security.includes(
        'no arbitrary'
      ) &&
      security.includes(
        'creator mint-to-wallet'
      )
    );

    assert.ok(
      security.includes(
        'independent third-party smart-contract/economic audit'
      )
    );

    assert.ok(
      security.includes(
        'transaction-locked'
      )
    );
  }
);

test(
  'metadata and PLITE docs reflect current public features',
  async () => {
    const metadata =
      await read(
        'docs/METADATA_UPLOADS.md'
      );

    const market =
      await read(
        'docs/PLITE_MARKET_DATA.md'
      );

    assert.ok(
      metadata.includes(
        'metadataUploads.enabled=true'
      )
    );

    assert.ok(
      metadata.includes(
        'wallet-authorized token image and metadata publishing'
      )
    );

    assert.ok(
      metadata.includes(
        'cannot prove that'
      ) &&
      metadata.includes(
        'Cloudflare'
      )
    );

    assert.equal(
      metadata.includes(
        'NOT deployed or enabled'
      ),
      false
    );

    assert.ok(
      market.includes(
        'separate Uniswap V2 PLITE/WETH pair'
      )
    );

    assert.ok(
      market.includes(
        'not part of PumpLite curve backing'
      )
    );

    assert.ok(
      market.includes(
        'Do not manufacture volume, holders or'
      ) &&
      market.includes(
        'trades to influence indexing.'
      )
    );
  }
);

test(
  'historical reports are scoped by CURRENT_STATUS',
  async () => {
    const status =
      await read(
        'docs/CURRENT_STATUS.md'
      );

    for (const name of [
      'IMPLEMENTATION_REPORT.md',
      'READINESS_FOLLOWUP.md',
      'RELEASE_CANDIDATE.md',
      'RELEASE_HANDOFF.md',
      'LOCAL_READINESS_CLOSURE.md'
    ]) {
      assert.ok(
        status.includes(name)
      );
    }

    assert.ok(
      status.includes(
        'historical verification checkpoints'
      )
    );
  }
);