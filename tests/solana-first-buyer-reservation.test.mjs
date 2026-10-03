import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';
import {
  webcrypto
} from 'node:crypto';

import {
  validateBuyerReservation
} from '../workers/pumplite-upload-guard/src/launches.js';

if (!globalThis.crypto) {
  globalThis.crypto =
    webcrypto;
}

const B58 =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes) {
  let zeros = 0;

  while (
    zeros < bytes.length &&
    bytes[zeros] === 0
  ) {
    zeros++;
  }

  let n = 0n;

  for (const byte of bytes) {
    n =
      n * 256n +
      BigInt(byte);
  }

  let body = '';

  while (n > 0n) {
    const digit =
      Number(n % 58n);

    body =
      B58[digit] +
      body;

    n /= 58n;
  }

  return (
    '1'.repeat(zeros) +
    body
  );
}

test(
  'buyer reservation signature binds launch mint market and buyer',
  async () => {
    const now =
      1_800_000_000_000;

    const buyerPair =
      await crypto.subtle
        .generateKey(
          {
            name: 'Ed25519'
          },
          true,
          [
            'sign',
            'verify'
          ]
        );

    const mintPair =
      await crypto.subtle
        .generateKey(
          {
            name: 'Ed25519'
          },
          true,
          [
            'sign',
            'verify'
          ]
        );

    const marketPair =
      await crypto.subtle
        .generateKey(
          {
            name: 'Ed25519'
          },
          true,
          [
            'sign',
            'verify'
          ]
        );

    const raw = async key =>
      new Uint8Array(
        await crypto.subtle
          .exportKey(
            'raw',
            key
          )
      );

    const record = {
      version: 1,
      chain: 'solana',
      programId:
        '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku',
      launchId:
        'ab'.repeat(32),
      mint:
        base58(
          await raw(
            mintPair.publicKey
          )
        ),
      market:
        base58(
          await raw(
            marketPair.publicKey
          )
        ),
      buyer:
        base58(
          await raw(
            buyerPair.publicKey
          )
        ),
      nonce:
        '22'.repeat(16),
      signedAt:
        now
    };

    const message =
      'PumpLite First Buyer Reservation\n' +
      'version=1\n' +
      JSON.stringify(record);

    const signature =
      new Uint8Array(
        await crypto.subtle
          .sign(
            'Ed25519',
            buyerPair.privateKey,
            new TextEncoder()
              .encode(message)
          )
      );

    const valid =
      await validateBuyerReservation(
        {
          ...record,
          message,
          signature:
            Buffer.from(
              signature
            ).toString(
              'base64'
            )
        },
        now
      );

    assert.equal(
      valid.launchId,
      record.launchId
    );

    assert.equal(
      valid.mint,
      record.mint
    );

    assert.equal(
      valid.buyer,
      record.buyer
    );

    await assert.rejects(
      () =>
        validateBuyerReservation(
          {
            ...record,
            mint:
              record.buyer,
            message,
            signature:
              Buffer.from(
                signature
              ).toString(
                'base64'
              )
          },
          now
        ),
      /mismatch|verification/i
    );
  }
);

test(
  'reservation API never serializes the local mint Keypair',
  async () => {
    const adapter =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    const start =
      adapter.indexOf(
        'async reserveFirstBuyer'
      );

    const end =
      adapter.indexOf(
        '\n    async create({',
        start
      );

    assert.ok(
      start >= 0 &&
      end > start
    );

    const method =
      adapter.slice(
        start,
        end
      );

    assert.match(
      method,
      /generateCompatibleMint/
    );

    assert.match(
      method,
      /signMessage/
    );

    assert.match(
      method,
      /\/launch\/reserve/
    );

    assert.doesNotMatch(
      method,
      /secretKey/
    );

    assert.doesNotMatch(
      method,
      /fromSecretKey/
    );

    assert.doesNotMatch(
      method,
      /JSON\.stringify\(local/
    );
  }
);

test(
  'server reservation storage contains public fields only',
  async () => {
    const source =
      await readFile(
        'workers/pumplite-upload-guard/src/launches.js',
        'utf8'
      );

    for (const forbidden of [
      /Keypair/,
      /secretKey/,
      /fromSecretKey/,
      /mint_secret/,
      /mintSecret/
    ]) {
      assert.doesNotMatch(
        source,
        forbidden
      );
    }

    assert.match(
      source,
      /launch_id TEXT PRIMARY KEY/
    );

    assert.match(
      source,
      /mint TEXT NOT NULL UNIQUE/
    );

    assert.match(
      source,
      /buyer TEXT NOT NULL/
    );
  }
);
