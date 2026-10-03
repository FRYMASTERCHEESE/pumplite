import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PublicKey,
  Transaction
} from '@solana/web3.js';
import { readFile } from 'node:fs/promises';

import {
  TINY_TOKEN_PROGRAM,
  tinyAta,
  tinyMarketAddress,
  buildTinyCreateInstructions,
  tinyTradeInstructions
} from '../web/solana-tiny-instructions.js';

const programId = new PublicKey(
  '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'
);

const owner = new PublicKey(
  new Uint8Array(32).fill(7)
);

const treasury = new PublicKey(
  'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'
);

function compatibleMint() {
  for (let i = 1; i < 255; i++) {
    try {
      const mint =
        new PublicKey(
          new Uint8Array(32).fill(i)
        );

      return {
        mint,
        market:
          tinyMarketAddress(
            mint,
            programId
          )
      };
    } catch {}
  }

  throw Error('No compatible fixture mint');
}

test('tiny builder is the reviewed PumpLite production route', async () => {
  const config = JSON.parse(
    await readFile(
      'config.json',
      'utf8'
    )
  );

  assert.equal(
    config.solana.clientVersion,
    5
  );

  assert.equal(
    config.solana.protocol,
    'tiny'
  );

  assert.equal(
    config.solana.programId,
    '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'
  );

  assert.equal(
    config.solana.transactionsEnabled,
    false
  );
});

test('tiny creation transaction fits Solana packet', () => {
  const built =
    buildTinyCreateInstructions({
      owner,
      programId,
      name: 'N'.repeat(32),
      symbol: 'ABCDEFGHIJ',
      uri: 'https://' + 'a'.repeat(192),
      mintRentLamports: 1_000_000
    });

  assert.equal(
    built.instructions.length,
    4
  );

  assert.equal(
    built.instructions[1].programId.toBase58(),
    TINY_TOKEN_PROGRAM.toBase58()
  );

  assert.equal(
    built.instructions[1].data[0],
    20
  );

  assert.equal(
    built.instructions[1].data[1],
    6
  );

  assert.equal(
    built.instructions[3].data[0],
    6
  );

  assert.equal(
    built.instructions[3].data[1],
    0
  );

  assert.equal(
    built.instructions[3].data[2],
    1
  );

  assert.ok(
    new PublicKey(
      built.instructions[3]
        .data
        .subarray(3, 35)
    ).equals(built.market)
  );

  const tx = new Transaction({
    feePayer: owner,
    recentBlockhash:
      '11111111111111111111111111111111'
  }).add(...built.instructions);

  tx.partialSign(
    built.mintKeypair
  );

  const bytes = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false
  }).length;

  assert.ok(
    bytes <= 1232,
    'creation packet too large: ' + bytes
  );
});

test('tiny BUY keeps five business accounts and appends CPI programs', () => {
  const { mint, market } =
    compatibleMint();

  const amount =
    (1n << 63n) + 17n;

  const min =
    (1n << 53n) + 3n;

  const instructions =
    tinyTradeInstructions({
      owner,
      mint,
      market,
      treasury,
      programId,
      side: 'buy',
      amount,
      min
    });

  assert.equal(
    instructions.length,
    2
  );

  const core =
    instructions[1];

  assert.equal(core.data.length, 17);
  assert.equal(core.data[0], 0);
  assert.equal(
    core.data.readBigUInt64LE(1),
    amount
  );
  assert.equal(
    core.data.readBigUInt64LE(9),
    min
  );
  assert.equal(core.keys.length, 7);

  assert.ok(
    core.keys[0].pubkey.equals(owner)
  );
  assert.ok(
    core.keys[1].pubkey.equals(market)
  );
  assert.ok(
    core.keys[2].pubkey.equals(mint)
  );
  assert.ok(
    core.keys[3].pubkey.equals(
      tinyAta(mint, owner)
    )
  );
  assert.ok(
    core.keys[4].pubkey.equals(treasury)
  );

  assert.equal(
    core.keys[5].pubkey.toBase58(),
    '11111111111111111111111111111111'
  );

  assert.equal(
    core.keys[6].pubkey.toBase58(),
    TINY_TOKEN_PROGRAM.toBase58()
  );
});

test('tiny SELL is one core instruction and wrong PDA is rejected', () => {
  const { mint, market } =
    compatibleMint();

  const instructions =
    tinyTradeInstructions({
      owner,
      mint,
      market,
      treasury,
      programId,
      side: 'sell',
      amount: 10n,
      min: 1n
    });

  assert.equal(instructions.length, 1);
  assert.equal(instructions[0].data.length, 17);
  assert.equal(instructions[0].data[0], 1);

  assert.throws(
    () =>
      tinyTradeInstructions({
        owner,
        mint,
        market: owner,
        treasury,
        programId,
        side: 'buy',
        amount: 1n,
        min: 1n
      }),
    /fixed-bump PDA/
  );
});