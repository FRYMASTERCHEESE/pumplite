import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test(
  'Pump adapter separates read RPC from signed transaction broadcast',
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
        'web/adapters/solana-pump.js',
        'utf8'
      );

    const worker =
      await readFile(
        'workers/pumplite-rpc/worker.js',
        'utf8'
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

    const required = [
      [
        /let\s+writeConnection\s*=/,
        'separate writeConnection'
      ],
      [
        /async\s+function\s+writeNetwork\s*\(/,
        'writeNetwork verification'
      ],
      [
        /writeConnection\s*\.\s*getGenesisHash\s*\(/,
        'write RPC genesis verification'
      ],
      [
        /writeConnection\s*\.\s*getLatestBlockhash\s*\(/,
        'write RPC latest blockhash'
      ],
      [
        /writeConnection\s*\.\s*simulateTransaction\s*\(/,
        'write RPC simulation'
      ],
      [
        /writeConnection\s*\.\s*sendRawTransaction\s*\(/,
        'write RPC broadcast'
      ],
      [
        /writeConnection\s*\.\s*confirmTransaction\s*\(/,
        'write RPC confirmation'
      ]
    ];

    for (
      const [
        pattern,
        label
      ] of required
    ) {
      assert.match(
        source,
        pattern,
        'Missing reviewed broadcast behavior: ' +
        label
      );
    }

    assert.doesNotMatch(
      source,
      /await\s+connection\s*\.\s*sendRawTransaction\s*\(/,
      'Read-only PumpLite Worker connection must never broadcast'
    );

    assert.doesNotMatch(
      worker,
      /^\s*"sendTransaction",?\s*$/m,
      'PumpLite Worker must remain read-only'
    );

    assert.match(
      worker,
      /"simulateTransaction"/
    );
  }
);