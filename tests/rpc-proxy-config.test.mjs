import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { securityHeaders } from '../scripts/security-headers.mjs';

const config =
  JSON.parse(
    await readFile(
      'config.json'
    )
  );

const html =
  await readFile(
    'index.html',
    'utf8'
  );

test(
  'Solana keeps read-only Worker and reviewed Mainnet broadcast RPC separated',
  () => {
    assert.equal(
      config.solana.rpcUrl,
      'https://pumplite-rpc.coreyedge123.workers.dev/rpc'
    );

    assert.deepEqual(
      config.solana.rpcFallbackUrls,
      ['https://solana-rpc.publicnode.com']
    );

    assert.equal(
      config.solana.genesisHash,
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
    );

    assert.equal(
      config.solana.protocol,
      'tiny'
    );

    assert.equal(
      config.solana.transactionsEnabled,
      false
    );

    assert.equal(
      config.solana.programId,
      '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'
    );

    assert.equal(
      config.solana.ammProgramId,
      undefined
    );

    assert.equal(
      config.solana.mayhemProgramId,
      undefined
    );

    assert.equal(
      config.base.transactionsEnabled,
      true
    );

    assert.equal(
      config.base.factory,
      '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4'
    );

    assert.equal(
      config.solana.treasury,
      'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'
    );

    assert.equal(
      config.base.treasury,
      '0x0de7fdcc798f7fac6b03b366c529133a9c60794d'
    );

    const read =
      new URL(
        config.solana.rpcUrl
      );

    const write =
      new URL(
        config.solana.rpcFallbackUrls[0]
      );

    for (
      const url of [
        read,
        write
      ]
    ) {
      assert.equal(
        url.protocol,
        'https:'
      );

      assert.equal(
        url.search,
        ''
      );

      assert.equal(
        url.username,
        ''
      );

      assert.equal(
        url.password,
        ''
      );
    }
  }
);

test(
  'CSP grants only reviewed RPC and existing Base destinations',
  () => {
    const policy =
      securityHeaders(
        html
      )[
        'Content-Security-Policy'
      ];

    const sources =
      policy
        .split(';')
        .map(
          value =>
            value.trim()
        )
        .find(
          value =>
            value.startsWith(
              'connect-src '
            )
        )
        .split(/\s+/)
        .slice(1);

    assert.deepEqual(
      sources,
      [
        "'self'",
        'https://pumplite-rpc.coreyedge123.workers.dev',
        'https://solana-rpc.publicnode.com',
        'wss://solana-rpc.publicnode.com',
        'https://mainnet.base.org',
        'https://base-rpc.publicnode.com',
        'https://api.coinbase.com'
      ]
    );
  }
);
