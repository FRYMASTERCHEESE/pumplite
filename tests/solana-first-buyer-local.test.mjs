import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Keypair,
  PublicKey,
  Transaction
} from '@solana/web3.js';

import {
  TINY_METADATA_PROGRAM,
  TINY_TOKEN_PROGRAM,
  buildTinyFirstBuyerActivationInstructions,
  tinyAta
} from '../web/solana-tiny-instructions.js';

const programId =
  new PublicKey(
    '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'
  );

const treasury =
  new PublicKey(
    'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'
  );

test(
  'first buyer locally creates atomic activation while creator stays metadata authority',
  () => {
    const buyer =
      Keypair.generate();

    const creator =
      Keypair.generate()
        .publicKey;

    const activation =
      buildTinyFirstBuyerActivationInstructions({
        buyer:
          buyer.publicKey,

        creator,

        programId,

        treasury,

        name:
          'N'.repeat(32),

        symbol:
          'ABCDEFGHIJ',

        uri:
          'https://' +
          'a'.repeat(192),

        mintRentLamports:
          1_500_000,

        buyAmount:
          2_000_000n,

        buyMinimum:
          1n
      });

    assert.equal(
      activation.instructions.length,
      6
    );

    const create =
      activation.instructions[0];

    const initialize =
      activation.instructions[1];

    const metadata =
      activation.instructions[2];

    const authority =
      activation.instructions[3];

    const ata =
      activation.instructions[4];

    const buy =
      activation.instructions[5];

    assert.equal(
      initialize.programId.toBase58(),
      TINY_TOKEN_PROGRAM.toBase58()
    );

    assert.equal(
      metadata.programId.toBase58(),
      TINY_METADATA_PROGRAM.toBase58()
    );

    /*
     * CreateMetadataAccountV3:
     * [2] mint authority = buyer, signer
     * [3] payer = buyer, signer
     * [4] update authority = ORIGINAL CREATOR, non-signer
     */
    assert.ok(
      metadata.keys[2]
        .pubkey
        .equals(
          buyer.publicKey
        )
    );

    assert.equal(
      metadata.keys[2].isSigner,
      true
    );

    assert.ok(
      metadata.keys[3]
        .pubkey
        .equals(
          buyer.publicKey
        )
    );

    assert.equal(
      metadata.keys[3].isSigner,
      true
    );

    assert.ok(
      metadata.keys[4]
        .pubkey
        .equals(
          creator
        )
    );

    assert.equal(
      metadata.keys[4].isSigner,
      false
    );

    assert.ok(
      create.keys.some(
        item =>
          item.pubkey.equals(
            activation.mint
          ) &&
          item.isSigner
      )
    );

    assert.equal(
      authority.data[0],
      6
    );

    assert.ok(
      ata.keys[1]
        .pubkey
        .equals(
          tinyAta(
            activation.mint,
            buyer.publicKey
          )
        )
    );

    /*
     * PumpLite business accounts remain first 5;
     * System + SPL Token remain trailing CPI support.
     */
    assert.equal(
      buy.keys.length,
      7
    );

    assert.ok(
      buy.keys[0]
        .pubkey
        .equals(
          buyer.publicKey
        )
    );

    assert.ok(
      buy.keys[2]
        .pubkey
        .equals(
          activation.mint
        )
    );

    assert.ok(
      buy.keys[4]
        .pubkey
        .equals(
          treasury
        )
    );

    assert.equal(
      buy.keys[5]
        .pubkey
        .toBase58(),
      '11111111111111111111111111111111'
    );

    assert.equal(
      buy.keys[6]
        .pubkey
        .toBase58(),
      TINY_TOKEN_PROGRAM.toBase58()
    );

    const tx =
      new Transaction({
        feePayer:
          buyer.publicKey,
        recentBlockhash:
          '11111111111111111111111111111111'
      })
        .add(
          ...activation.instructions
        );

    /*
     * Both required signatures are local for this unit fixture.
     * In production:
     * - buyer signature comes from Phantom
     * - disposable mint signature is browser-local
     */
    tx.partialSign(
      activation.mintKeypair,
      buyer
    );

    assert.equal(
      tx.verifySignatures(),
      true
    );

    const bytes =
      tx.serialize()
        .length;

    assert.ok(
      bytes <= 1232,
      'First-buyer activation packet too large: ' +
      bytes
    );

    /*
     * The mint private key exists only in this browser-side
     * activation object. Public reservation data requires only
     * these public addresses.
     */
    const publicReservation =
      JSON.stringify({
        mint:
          activation.mint
            .toBase58(),
        market:
          activation.market
            .toBase58(),
        buyer:
          buyer.publicKey
            .toBase58()
      });

    assert.doesNotMatch(
      publicReservation,
      /secret|private/i
    );
  }
);

test(
  'reserved local mint can be reused without generating a replacement',
  () => {
    const buyer =
      Keypair.generate();

    const creator =
      Keypair.generate()
        .publicKey;

    const localMint =
      Keypair.generate();

    let activation;

    /*
     * Fixed bump 255 rejects roughly half of random mints.
     * Find one compatible local signer for this fixture.
     */
    for (let i = 0; i < 2048; i++) {
      const candidate =
        i === 0
          ? localMint
          : Keypair.generate();

      try {
        activation =
          buildTinyFirstBuyerActivationInstructions({
            buyer:
              buyer.publicKey,
            creator,
            programId,
            treasury,
            name:
              'Reserved Mint',
            symbol:
              'RSV',
            uri:
              '',
            mintRentLamports:
              1_500_000,
            buyAmount:
              1_000_000n,
            buyMinimum:
              1n,
            mintKeypair:
              candidate
          });

        assert.ok(
          activation.mint.equals(
            candidate.publicKey
          )
        );

        assert.equal(
          activation.mintKeypair,
          candidate
        );

        return;
      } catch (
        error
      ) {
        if (
          !/Unable|curve|address|invalid/i
            .test(
              String(
                error?.message ||
                error
              )
            )
        ) {
          /*
           * createProgramAddressSync may reject an on-curve
           * candidate. Try another.
           */
          continue;
        }
      }
    }

    assert.fail(
      'Unable to find compatible fixture mint'
    );
  }
);
