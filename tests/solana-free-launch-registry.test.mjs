import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';
import {
  webcrypto
} from 'node:crypto';

import {
  validateSignedLaunch
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

function hex(bytes) {
  return Array.from(
    bytes,
    byte =>
      byte
        .toString(16)
        .padStart(2, '0')
  ).join('');
}

test(
  'signed creator launch verifies with public data only',
  async () => {
    const now =
      1_800_000_000_000;

    const pair =
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

    const publicRaw =
      new Uint8Array(
        await crypto.subtle
          .exportKey(
            'raw',
            pair.publicKey
          )
      );

    const record = {
      version: 1,
      chain: 'solana',
      programId:
        '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku',
      creator:
        base58(publicRaw),
      name:
        'Free Launch',
      symbol:
        'FREE',
      uri:
        'https://example.com/free.json',
      nonce:
        '11'.repeat(16),
      createdAt:
        now
    };

    const canonical =
      JSON.stringify(record);

    const message =
      'PumpLite Free Solana Launch\n' +
      'version=1\n' +
      canonical;

    const id =
      hex(
        new Uint8Array(
          await crypto.subtle
            .digest(
              'SHA-256',
              new TextEncoder()
                .encode(
                  canonical
                )
            )
        )
      );

    const signature =
      new Uint8Array(
        await crypto.subtle
          .sign(
            'Ed25519',
            pair.privateKey,
            new TextEncoder()
              .encode(
                message
              )
          )
      );

    const launch =
      await validateSignedLaunch(
        {
          ...record,
          id,
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
      launch.id,
      id
    );

    assert.equal(
      launch.creator,
      record.creator
    );

    await assert.rejects(
      () =>
        validateSignedLaunch(
          {
            ...record,
            name:
              'Tampered',
            id,
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
  'registry cannot hold mint private-key material',
  async () => {
    const source =
      await readFile(
        'workers/pumplite-upload-guard/src/launches.js',
        'utf8'
      );

    for (const pattern of [
      /Keypair/,
      /fromSecretKey/,
      /secretKey/,
      /mint_secret/,
      /mintSecret/
    ]) {
      assert.doesNotMatch(
        source,
        pattern
      );
    }
  }
);

test(
  'free creator method remains message-only',
  async () => {
    const source =
      await readFile(
        'web/adapters/solana-tiny.js',
        'utf8'
      );

    const start =
      source.indexOf(
        'async createFreeDraft'
      );

    const end =
      source.indexOf(
        '\n    async create({',
        start
      );

    assert.ok(
      start >= 0 &&
      end > start
    );

    const free =
      source.slice(
        start,
        end
      );

    assert.match(
      free,
      /signMessage/
    );

    assert.match(
      free,
      /\/launch\/register/
    );

    for (const forbidden of [
      'signTransaction',
      'sendRawTransaction',
      'partialSign',
      'SystemProgram.createAccount'
    ]) {
      assert.equal(
        free.includes(
          forbidden
        ),
        false
      );
    }
  }
);
