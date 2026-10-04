import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  Transaction
} from '@solana/web3.js';

import {
  adapter
} from '../web/adapters/solana-tiny.js';

import {
  signatureText
} from '../web/solana-signature.js';

import {
  readFile
} from 'node:fs/promises';

const config =
  JSON.parse(
    await readFile(
      'config.json',
      'utf8'
    )
  ).solana;

test(
  'PumpLite accepts only Phantom Compute Budget normalization and preserves exact signed transaction',
  async t => {
    const owner =
      Keypair.generate();

    let submitted = 0;
    let simulated = 0;
    let signedCount=0, preflightError=false;
    const signatureChecks=[];

    const provider = {
      publicKey:
        owner.publicKey,

      async connect() {
        return {
          publicKey:
            owner.publicKey
        };
      },

      async signTransaction(tx) {
        signedCount++;
        /*
         * Mimic the behavior observed from real Phantom:
         *
         *   1. SetComputeUnitPrice
         *   2. SetComputeUnitLimit
         *   3... original PumpLite instructions
         *
         * Serialize/decode once to mimic wallet recompilation
         * and global account-meta normalization.
         */
        const signed =
          new Transaction({
            feePayer:
              tx.feePayer,
            recentBlockhash:
              tx.recentBlockhash
          });

        signed.add(
          ComputeBudgetProgram
            .setComputeUnitPrice({
              microLamports:
                375_000
            })
        );

        signed.add(
          ComputeBudgetProgram
            .setComputeUnitLimit({
              units:
                200_000
            })
        );

        signed.add(
          ...tx.instructions
        );

        signed.partialSign(
          owner
        );

        return Transaction.from(
          signed.serialize({
            requireAllSignatures:
              false,
            verifySignatures:
              false
          })
        );
      },

      on() {},
      removeListener() {}
    };

    const oldWindow =
      Object.getOwnPropertyDescriptor(
        globalThis,
        'window'
      );

    Object.defineProperty(
      globalThis,
      'window',
      {
        configurable: true,
        value: {
          phantom: {
            solana:
              provider
          },
          solana:
            provider
        }
      }
    );

    t.after(() => {
      if (oldWindow) {
        Object.defineProperty(
          globalThis,
          'window',
          oldWindow
        );
      } else {
        delete globalThis.window;
      }
    });

    t.mock.method(
      Connection.prototype,
      'getGenesisHash',
      async function () {
        /*
         * web3.js creates _rpcRequest on each Connection
         * instance rather than on Connection.prototype.
         *
         * Install the fake simulator on the real instance
         * used by the PumpLite adapter.
         */
        this._rpcRequest =
          async (
            method, params
          ) => {
            assert.equal(
              method,
              'simulateTransaction'
            );

            simulated++;
            signatureChecks.push(params[1].sigVerify);

            return {
              result: {
                value: {
                  err: preflightError ? {InsufficientFundsForRent:{account_index:4}} : null,
                  logs: []
                }
              }
            };
          };

        return config.genesisHash;
      }
    );

    t.mock.method(
      Connection.prototype,
      'getLatestBlockhash',
      async () => ({
        blockhash:
          '11111111111111111111111111111111',
        lastValidBlockHeight:
          999_999
      })
    );

    t.mock.method(
      Connection.prototype,
      'getMinimumBalanceForRentExemption',
      async () =>
        1_500_000
    );

    t.mock.method(
      Connection.prototype,
      'getFeeForMessage',
      async () => ({
        value:
          80_000
      })
    );


    t.mock.method(
      Connection.prototype,
      'sendRawTransaction',
      async raw => {
        submitted++;

        const decoded =
          Transaction.from(
            raw
          );

        assert.equal(
          decoded.instructions[0]
            .programId
            .toBase58(),
          'ComputeBudget111111111111111111111111111111'
        );

        assert.equal(
          decoded.instructions[1]
            .programId
            .toBase58(),
          'ComputeBudget111111111111111111111111111111'
        );

        assert.equal(
          decoded.verifySignatures(),
          true
        );

        return signatureText(
          decoded.signature
        );
      }
    );

    t.mock.method(
      Connection.prototype,
      'confirmTransaction',
      async () => ({
        context: {
          slot: 1
        },
        value: {
          err: null
        }
      })
    );

    const client =
      adapter(
        {
          ...config,
          rpcFallbackUrls: [],
          rpcUrl:
            'http://127.0.0.1:8899'
        },
        () => {}
      );

    const wallet =
      await client.connect();

    assert.equal(
      wallet,
      owner.publicKey.toBase58()
    );

    const mint =
      await client.create({
        name:
          'PumpLite Smoke',
        symbol:
          'PLSMK',
        uri:
          'https://example.invalid/pumplite-smoke.json'
      });

    assert.equal(
      typeof mint,
      'string'
    );

    assert.equal(
      simulated,
      2,
      'unsigned preflight and exact signed transaction must both be simulated'
    );

    assert.equal(
      submitted,
      1,
      'synthetic transaction must reach mocked submission exactly once'
    );
    assert.deepEqual(signatureChecks,[false,true]);
    preflightError=true;
    await assert.rejects(client.create({name:'Blocked',symbol:'BLOCK',uri:'https://example.invalid/blocked.json'}),/Pre-sign simulation failed/);
    assert.equal(signedCount,1,'failed preflight must not request another wallet signature');
    assert.equal(submitted,1,'failed preflight must not broadcast');
  }
);
