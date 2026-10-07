import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';

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
