import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';
import { decodeBase58 } from '../workers/pumplite-upload-guard/src/solana-identity.js';

test(
  'PumpLite activation registry is independently verified and fail-closed',
  async () => {
    const guard =
      await readFile(
        'workers/pumplite-upload-guard/src/launches.js',
        'utf8'
      );

    const rpc =
      await readFile(
        'workers/pumplite-rpc/worker.js',
        'utf8'
      );

    const adapter =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    const app =
      await readFile(
        'web/app.js',
        'utf8'
      );

    const ui =
      await readFile(
        'web/solana-launch-ui.js',
        'utf8'
      );

    const config =
      JSON.parse(
        await readFile(
          'config.json',
          'utf8'
        )
      );

    assert.equal(
      config.solana.transactionsEnabled,
      true
    );

    assert.equal(
      config.solana.discoveryUrl,
      'https://pumplite-rpc.coreyedge123.workers.dev/launch/activated/'
    );

    assert.match(
      guard,
      /solana_launch_activations/
    );

    assert.match(
      guard,
      /derivePumpLiteMarketAddress/
    );

    assert.match(
      guard,
      /Reservation market mismatch/
    );

    assert.match(
      guard,
      /parseActivatedOffset/
    );

    assert.match(
      guard,
      /\/launch\/finalize-verified/
    );

    for (const marker of [
      'getSignatureStatuses',
      'getTransaction',
      'getAccountInfo',
      'getTokenAccountsByOwner',
      'On-chain PumpLite mint state failed verification',
      'On-chain token metadata does not match the signed PumpLite launch',
      '/launch/finalize'
    ]) {
      assert.ok(
        rpc.includes(marker),
        'Missing independent finalizer marker: ' +
          marker
      );
    }

    assert.match(
      adapter,
      /finalizeLaunchRegistry/
    );

    assert.match(
      adapter,
      /retryFinalizeFirstBuyer/
    );

    assert.match(
      adapter,
      /pendingLaunches/
    );

    assert.match(
      app,
      /solana-launch-ui\.js/
    );

    assert.match(
      ui,
      /reserveFirstBuyer/
    );

    assert.match(
      ui,
      /activateReservedFirstBuyer/
    );

    assert.match(
      ui,
      /retryFinalizeFirstBuyer/
    );

    assert.match(
      ui,
      /Buy amount \(SOL\)/
    );

    assert.doesNotMatch(
      ui,
      /final release checks/i
    );

    assert.doesNotMatch(
      ui,
      /final spend-review unlock/i
    );

    assert.doesNotMatch(
      guard,
      /Keypair|fromSecretKey|secretKey|mint_secret|mintSecret/
    );

    assert.doesNotMatch(
      rpc,
      /sendRawTransaction/
    );
  }
);

test(
  'finalizer Base58 decoder accepts 64-byte transaction signatures and 32-byte public keys',
  () => {
    const signature = '45BnbRhTP3nhA3jSwAir5kHMTWfYNgjQ438cPRnWEWpYjGf4GpAbVW51fNUR4EsvG7PkJ76BhL9yZYugh1Dyxc3G';
    const mint = 'FEofu2h5RY4yyuoZJKT4VhwWqJ78ScEy6WjoFCyQ1Xqe';
    assert.equal(decodeBase58(signature)?.length, 64);
    assert.equal(decodeBase58(mint)?.length, 32);
    assert.equal(decodeBase58('1'.repeat(91)), null);
  }
);
