import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test(
  'tiny adapter keeps reviewed signed Mainnet writes on the PumpLite RPC path',
  async () => {
    const config =
      JSON.parse(
        await readFile(
          'config.json',
          'utf8'
        )
      );

    const source =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    const worker =
      await readFile(
        'workers/pumplite-rpc/worker.js',
        'utf8'
      );

    assert.equal(
      config.solana.transactionsEnabled,
      true
    );

    assert.equal(
      config.solana.rpcUrl,
      'https://pumplite-rpc.coreyedge123.workers.dev/rpc'
    );

    assert.deepEqual(
      config.solana.rpcFallbackUrls,
      [
        'https://solana-rpc.publicnode.com'
      ]
    );

    for (const pattern of [
      /const\s+writeConnection\s*=/,
      /async\s+function\s+writeNetwork\s*\(/,
      /writeConnection\s*\.\s*getGenesisHash\s*\(/,
      /writeConnection\s*\.\s*getLatestBlockhash\s*\(/,
      /writeConnection\s*\.\s*_rpcRequest\s*\(/,
      /broadcastConnection\s*\.\s*sendRawTransaction\s*\(/,
      /writeConnection\s*\.\s*confirmTransaction\s*\(/
    ]) {
      assert.match(
        source,
        pattern
      );
    }

    const sendStart =
      source.indexOf(
        'async function send('
      );

    const sendEnd =
      source.indexOf(
        'async function market(',
        sendStart
      );

    const send =
      source.slice(
        sendStart,
        sendEnd
      );

    assert.doesNotMatch(
      send,
      /await\s+connection\s*\.\s*sendRawTransaction/
    );

    assert.match(
      worker,
      /^\s*"sendTransaction",?\s*$/m
    );

    assert.doesNotMatch(
      worker,
      /^\s*"sendRawTransaction",?\s*$/m
    );
  }
);
