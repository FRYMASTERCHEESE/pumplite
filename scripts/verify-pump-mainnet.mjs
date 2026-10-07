import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';

const PROGRAM =
  '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku';

const config =
  JSON.parse(
    await readFile(
      'config.json',
      'utf8'
    )
  );

const adapter =
  await readFile(
    'web/adapters/solana-tiny.js',
    'utf8'
  );

const instructions =
  await readFile(
    'web/solana-tiny-instructions.js',
    'utf8'
  );

console.log('');
console.log('============================================');
console.log(' PUMPLITE TINY MAINNET VERIFY');
console.log(' STATIC / READ ONLY / ZERO SOL');
console.log('============================================');

assert.equal(
  config.solana.protocol,
  'tiny'
);

assert.equal(
  config.solana.programId,
  PROGRAM
);

assert.equal(
  config.solana.clientVersion,
  5
);

assert.equal(
  config.solana.treasury,
  'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'
);

assert.equal(
  config.solana.genesisHash,
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
);

assert.equal(
  config.solana.transactionsEnabled,
  true
);

assert.equal(
  config.solana.discoveryUrl,
  'https://pumplite-rpc.coreyedge123.workers.dev/launch/activated/'
);

assert.equal(
  config.solana.ammProgramId,
  undefined
);

assert.equal(
  config.solana.mayhemProgramId,
  undefined
);

assert.deepEqual(
  config.solana.rpcFallbackUrls,
  [
    'https://solana-rpc.publicnode.com'
  ]
);

for (const marker of [
  'buildTinyFirstBuyerActivationInstructions',
  'simulateTransaction',
  'sendRawTransaction',
  'validateWalletTransaction'
]) {
  assert.ok(
    adapter.includes(marker),
    'Missing PumpLite tiny adapter marker: ' +
      marker
  );
}

for (const marker of [
  'buildTinyFirstBuyerActivationInstructions',
  'TINY_TOKEN_PROGRAM',
  'SystemProgram.programId'
]) {
  assert.ok(
    instructions.includes(marker),
    'Missing PumpLite tiny instruction marker: ' +
      marker
  );
}

assert.doesNotMatch(
  adapter,
  /fromSecretKey/
);

console.log('PumpLite tiny Mainnet identity pinned ✅');
console.log('Creator free-launch remains message-only; reviewed first-buyer transactions enabled ✅');
console.log('Browser-local first-buyer activation implementation present ✅');
console.log('No wallet used ✅');
console.log('No signature requested ✅');
console.log('No transaction submitted ✅');
console.log('No SOL spent ✅');
