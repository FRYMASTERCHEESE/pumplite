import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram
} from '@solana/web3.js';
import { Buffer } from 'buffer';

import {
  solanaProvider,
  watchWallet
} from '../wallets.js';

import {
  signatureText
} from '../solana-signature.js';

import {
  validateIndexPage
} from '../discovery.js';

import {
  boundedFetch
} from '../rpc-fetch.js';

import {
  assertSolanaMainnet
} from '../solana-network.js';

import {
  SOL_SUPPLY,
  assertSolanaConfirmation
} from '../math.js';

import {
  TINY_TOKEN_PROGRAM,
  TINY_METADATA_PROGRAM,
  TINY_MINT_SIZE,
  tinyAta,
  tinyMarketAddress,
  tinyMetadataAddress,
  buildTinyCreateInstructions,
  tinyTradeInstructions
} from '../solana-tiny-instructions.js';

const enc = new TextEncoder();

function readString(
  data,
  state,
  max
) {
  if (state.offset + 4 > data.length) {
    throw Error('Invalid Solana metadata');
  }

  const length =
    data.readUInt32LE(state.offset);

  state.offset += 4;

  if (
    length > max ||
    state.offset + length > data.length
  ) {
    throw Error('Invalid Solana metadata');
  }

  const value =
    new TextDecoder(
      'utf-8',
      { fatal: true }
    )
      .decode(
        data.subarray(
          state.offset,
          state.offset + length
        )
      )
      .replace(/\0+$/g, '');

  state.offset += length;

  return value;
}

function decodeMetadata(
  account,
  mint
) {
  if (
    !account ||
    !account.owner.equals(
      TINY_METADATA_PROGRAM
    )
  ) {
    throw Error(
      'Missing or invalid Metaplex metadata'
    );
  }

  const data =
    Buffer.from(account.data);

  if (data.length < 65) {
    throw Error('Invalid Metaplex metadata');
  }

  const metadataMint =
    new PublicKey(
      data.subarray(33, 65)
    );

  if (!metadataMint.equals(mint)) {
    throw Error(
      'Metadata mint does not match token'
    );
  }

  const updateAuthority =
    new PublicKey(
      data.subarray(1, 33)
    )
      .toBase58();

  const state = {
    offset: 65
  };

  const name =
    readString(data, state, 32);

  const symbol =
    readString(data, state, 10);

  const uri =
    readString(data, state, 200);

  return {
    updateAuthority,
    name,
    symbol,
    uri
  };
}

export function adapter(
  config,
  notify,
  changed = () => {}
) {
  assertSolanaMainnet(
    config.genesisHash
  );

  const makeConnection =
    url =>
      new Connection(
        url,
        {
          commitment: 'confirmed',
          fetch: boundedFetch,
          disableRetryOnRateLimit: true
        }
      );

  const urls = [
    config.rpcUrl,
    ...(config.rpcFallbackUrls || [])
  ];

  if (urls.length > 2) {
    throw Error(
      'At most one Solana RPC fallback is allowed'
    );
  }

  for (const url of urls.slice(1)) {
    const value = new URL(url);

    if (
      value.protocol !== 'https:' ||
      value.username ||
      value.password ||
      value.search ||
      value.hash
    ) {
      throw Error(
        'Invalid public Solana fallback URL'
      );
    }
  }

  let connection =
    makeConnection(urls[0]);

  let preparedAt = 0;
  let preparedProvider;
  let connected;
  let selected;
  let revision = 0;
  let unwatch = () => {};

  const program = () => {
    if (!config.programId) {
      throw Error(
        'Tiny Solana program has not been deployed yet'
      );
    }

    return new PublicKey(
      config.programId
    );
  };

  function disconnect() {
    revision++;
    connected = undefined;
    selected = undefined;
    unwatch();
    unwatch = () => {};
    changed();
  }

  async function network() {
    let hash;

    try {
      hash =
        await connection.getGenesisHash();
    } catch (error) {
      if (urls.length < 2) {
        throw error;
      }

      const other =
        urls.find(
          url =>
            url !==
            connection.rpcEndpoint
        );

      notify(
        'Solana RPC unavailable: ' +
        error.message +
        '. Checking configured fallback ' +
        new URL(other).host +
        '. No transaction is retried.'
      );

      const fallback =
        makeConnection(other);

      const fallbackHash =
        await fallback.getGenesisHash();

      assertSolanaMainnet(
        fallbackHash
      );

      connection = fallback;
      return;
    }

    assertSolanaMainnet(hash);
  }

  async function wallet() {
    if (
      !connected ||
      !selected?.publicKey?.equals(
        connected
      )
    ) {
      throw Error(
        'Wallet changed or disconnected; reconnect'
      );
    }

    const attempt = revision;

    await network();

    if (
      attempt !== revision ||
      !selected?.publicKey?.equals(
        connected
      )
    ) {
      throw Error(
        'Wallet changed or disconnected; reconnect'
      );
    }

    return connected;
  }

  async function send(
    instructions,
    localSigners = []
  ) {
    const owner =
      await wallet();

    const latest =
      await connection
        .getLatestBlockhash(
          'confirmed'
        );

    const tx =
      new Transaction({
        feePayer: owner,
        ...latest
      })
        .add(...instructions);

    if (localSigners.length) {
      tx.partialSign(
        ...localSigners
      );
    }

    const localSignatures =
      localSigners.map(
        signer => {
          const item =
            tx.signatures.find(
              entry =>
                entry.publicKey.equals(
                  signer.publicKey
                )
            );

          if (!item?.signature) {
            throw Error(
              'Local Solana signer was not applied'
            );
          }

          return {
            publicKey:
              signer.publicKey,
            signature:
              Buffer.from(
                item.signature
              )
          };
        }
      );

    const message =
      Buffer.from(
        tx.serializeMessage()
      );

    notify(
      'Review and approve the transaction in your Solana wallet.'
    );

    const signed =
      await selected
        .signTransaction(tx);

    if (
      !signed?.serializeMessage ||
      !message.equals(
        Buffer.from(
          signed.serializeMessage()
        )
      )
    ) {
      throw Error(
        'Wallet changed the transaction'
      );
    }

    for (
      const local of
      localSignatures
    ) {
      const item =
        signed.signatures.find(
          entry =>
            entry.publicKey.equals(
              local.publicKey
            )
        );

      if (
        !item?.signature ||
        !local.signature.equals(
          Buffer.from(
            item.signature
          )
        )
      ) {
        throw Error(
          'Wallet removed a required mint signature'
        );
      }
    }

    await wallet();

    const expectedSignature =
      signatureText(
        signed.signature
      );

    notify(
      'Submitting to Solana. If the response is interrupted, inspect this transaction before retrying.',
      config.explorer +
      '/tx/' +
      expectedSignature
    );

    const signature =
      await connection
        .sendRawTransaction(
          signed.serialize()
        );

    if (
      signature !==
      expectedSignature
    ) {
      throw Error(
        'RPC returned an unexpected transaction signature'
      );
    }

    notify(
      'Submitted. Waiting for Solana confirmation.',
      config.explorer +
      '/tx/' +
      signature
    );

    const confirmation =
      await connection
        .confirmTransaction(
          {
            signature,
            ...latest
          },
          'confirmed'
        );

    assertSolanaConfirmation(
      confirmation
    );

    notify(
      'Confirmed on Solana.',
      config.explorer +
      '/tx/' +
      signature
    );

    return signature;
  }

  async function market(id) {
    await network();

    const mint =
      new PublicKey(id);

    const marketAddress =
      tinyMarketAddress(
        mint,
        program()
      );

    const metadata =
      tinyMetadataAddress(mint);

    const result =
      await connection
        .getMultipleAccountsInfoAndContext(
          [
            mint,
            metadata,
            marketAddress
          ],
          'confirmed'
        );

    const [
      mintAccount,
      metadataAccount,
      marketAccount
    ] = result.value;

    if (
      !mintAccount ||
      !mintAccount.owner.equals(
        TINY_TOKEN_PROGRAM
      )
    ) {
      throw Error(
        'Invalid PumpLite Solana mint'
      );
    }

    const mintData =
      Buffer.from(
        mintAccount.data
      );

    if (
      mintData.length !==
      TINY_MINT_SIZE ||
      mintData[44] !== 6 ||
      mintData[45] !== 1
    ) {
      throw Error(
        'Unsupported PumpLite Solana mint'
      );
    }

    if (
      !mintData
        .subarray(0, 4)
        .equals(
          Buffer.from(
            [1, 0, 0, 0]
          )
        )
    ) {
      throw Error(
        'PumpLite market is not mint authority'
      );
    }

    if (
      !new PublicKey(
        mintData.subarray(
          4,
          36
        )
      )
        .equals(
          marketAddress
        )
    ) {
      throw Error(
        'Unexpected PumpLite mint authority'
      );
    }

    if (
      !mintData
        .subarray(46, 50)
        .equals(
          Buffer.from(
            [0, 0, 0, 0]
          )
        )
    ) {
      throw Error(
        'PumpLite mint has a freeze authority'
      );
    }

    const circulating =
      mintData
        .readBigUInt64LE(36);

    if (
      circulating >
      SOL_SUPPLY
    ) {
      throw Error(
        'PumpLite token exceeds maximum supply'
      );
    }

    const tokenReserve =
      SOL_SUPPLY -
      circulating;

    if (tokenReserve <= 0n) {
      throw Error(
        'PumpLite token reserve is exhausted'
      );
    }

    if (marketAccount) {
      if (
        !marketAccount.owner.equals(
          SystemProgram.programId
        ) ||
        marketAccount.data.length !== 0
      ) {
        throw Error(
          'Invalid PumpLite market SOL account'
        );
      }

      if (
        !Number.isSafeInteger(
          marketAccount.lamports
        )
      ) {
        throw Error(
          'Market SOL balance exceeds safe RPC integer range'
        );
      }
    }

    const identity =
      decodeMetadata(
        metadataAccount,
        mint
      );

    return {
      id: mint.toBase58(),
      token: mint.toBase58(),
      marketAddress:
        marketAddress.toBase58(),
      creator:
        identity.updateAuthority,
      name: identity.name,
      symbol: identity.symbol,
      uri: identity.uri,
      nativeReserve:
        BigInt(
          marketAccount?.lamports ||
          0
        ),
      tokenReserve,
      volume: 0n,
      decimals: 6,
      nativeDecimals: 9,
      unit: 'SOL',
      virtualNative:
        30_000_000_000n,
      supply: SOL_SUPPLY,
      source:
        'PumpLite tiny Solana core · confirmed slot ' +
        result.context.slot,
      observedAt: Date.now()
    };
  }

  return {
    disconnect,

    verifyNetwork:
      network,

    async prepareConnect() {
      preparedAt = 0;
      preparedProvider = undefined;

      const candidate =
        solanaProvider();

      if (!candidate) {
        throw Error(
          'Provider detection: no compatible Solana provider. Reload inside Phantom’s browser.'
        );
      }

      preparedProvider =
        candidate;

      preparedAt =
        Date.now();

      notify(
        'Phantom ready. Tap Connect wallet again within 30 seconds to request account access. No signing is requested.'
      );
    },

    async connect(
      prepared = false
    ) {
      disconnect();

      const attempt =
        revision;

      const candidate =
        solanaProvider();

      if (!candidate) {
        throw Error(
          'No Solana wallet detected. Open this page in Phantom, then connect.'
        );
      }

      selected =
        candidate;

      unwatch =
        watchWallet(
          candidate,
          ['disconnect'],
          disconnect
        );

      try {
        if (prepared) {
          if (
            preparedProvider !==
              candidate ||
            !preparedAt ||
            Date.now() -
              preparedAt >
              30_000
          ) {
            throw Error(
              'Preparation expired or provider changed. Tap Connect wallet to prepare again.'
            );
          }
        } else {
          await network();
        }

        preparedAt = 0;
        preparedProvider =
          undefined;

        if (
          attempt !== revision
        ) {
          throw Error(
            'Wallet changed; reconnect'
          );
        }

        notify(
          'Phantom request sent. Approve account access in Phantom, or reject it. No transaction is requested.'
        );

        let timer;

        const waiting =
          setTimeout(
            () =>
              notify(
                'Still waiting for Phantom. Check its approval screen. If none appears, reload this page before retrying; no transaction was sent.'
              ),
            12_000
          );

        let result;

        try {
          result =
            await Promise.race([
              candidate.connect(),
              new Promise(
                (_, reject) => {
                  timer =
                    setTimeout(
                      () =>
                        reject(
                          Error(
                            'Phantom connection timed out after 60 seconds. Reload before retrying.'
                          )
                        ),
                      60_000
                    );
                }
              )
            ]);
        } finally {
          clearTimeout(timer);
          clearTimeout(waiting);
        }

        if (
          attempt !== revision
        ) {
          throw Error(
            'Wallet changed; reconnect'
          );
        }

        connected =
          result?.publicKey;

        if (
          !connected ||
          !candidate.publicKey
            ?.equals(connected)
        ) {
          throw Error(
            'Phantom returned no matching public account. Reconnect.'
          );
        }

        unwatch();

        unwatch =
          watchWallet(
            candidate,
            [
              'disconnect',
              'accountChanged'
            ],
            disconnect
          );

        notify(
          'Phantom approved account access. On-chain operations still require Mainnet RPC verification.'
        );

        if (!prepared) {
          await wallet();
        }

        return connected
          .toBase58();
      } catch (error) {
        if (
          attempt === revision
        ) {
          disconnect();
        }

        throw Error(
          'Solana connection failed' +
          (
            error.code !== undefined
              ? ' (code ' +
                String(error.code)
                  .slice(0, 20) +
                ')'
              : ''
          ) +
          ': ' +
          (
            error.message ||
            'Unknown provider error'
          )
        );
      }
    },

    async signMetadataMessage(
      message
    ) {
      if (
        typeof message !== 'string' ||
        enc.encode(message).length >
          2048
      ) {
        throw Error(
          'Metadata authorization message is invalid'
        );
      }

      const owner =
        await wallet();

      const attempt =
        revision;

      if (
        typeof selected
          ?.signMessage !==
        'function'
      ) {
        throw Error(
          'This Solana wallet does not support message signing'
        );
      }

      notify(
        'Review the metadata authorization message. This signature does not spend SOL.'
      );

      const result =
        await selected
          .signMessage(
            enc.encode(message),
            'utf8'
          );

      if (
        attempt !== revision ||
        !selected?.publicKey
          ?.equals(owner)
      ) {
        throw Error(
          'Wallet changed while signing; reconnect'
        );
      }

      const signature =
        Buffer.from(
          result?.signature || []
        );

      if (
        signature.length !== 64
      ) {
        throw Error(
          'Wallet returned an invalid Solana signature'
        );
      }

      return signature
        .toString('base64');
    },

    async list(offset = 0) {
      await network();

      if (
        !Number.isSafeInteger(
          offset
        ) ||
        offset < 0 ||
        offset % 8
      ) {
        throw Error(
          'Invalid discovery page'
        );
      }

      // Tiny markets do not use program-owned market state.
      // Until a verified public index is configured, exact mint links
      // still work but discovery intentionally returns no fake entries.
      if (!config.discoveryUrl) {
        return {
          markets: [],
          next: null
        };
      }

      const base =
        new URL(
          config.discoveryUrl,
          globalThis.location?.href ||
          'https://invalid.example/'
        );

      if (
        base.protocol !== 'https:' ||
        base.username ||
        base.password ||
        base.search ||
        base.hash
      ) {
        throw Error(
          'Invalid discovery endpoint'
        );
      }

      if (
        !base.pathname.endsWith('/')
      ) {
        base.pathname += '/';
      }

      const page =
        validateIndexPage(
          await (
            await boundedFetch(
              new URL(
                offset + '.json',
                base
              ),
              {},
              {
                maxBytes: 8192
              }
            )
          ).json(),
          config,
          offset
        );

      return {
        markets:
          await Promise.all(
            page.markets.map(
              id => market(id)
            )
          ),
        next: page.next
      };
    },

    market,

    async balances(m) {
      const owner =
        await wallet();

      const tokenAddress =
        tinyAta(
          new PublicKey(m.token),
          owner
        );

      const [
        native,
        info
      ] =
        await Promise.all([
          connection.getBalance(
            owner
          ),
          connection.getAccountInfo(
            tokenAddress
          )
        ]);

      if (
        !Number.isSafeInteger(
          native
        )
      ) {
        throw Error(
          'Native balance exceeds safe RPC integer range'
        );
      }

      let tokens = 0n;

      if (info) {
        const data =
          Buffer.from(
            info.data
          );

        if (
          !info.owner.equals(
            TINY_TOKEN_PROGRAM
          ) ||
          data.length !== 165 ||
          data[108] !== 1 ||
          !new PublicKey(
            data.subarray(0, 32)
          )
            .equals(
              new PublicKey(
                m.token
              )
            ) ||
          !new PublicKey(
            data.subarray(32, 64)
          )
            .equals(owner)
        ) {
          throw Error(
            'Invalid wallet token account'
          );
        }

        tokens =
          data.readBigUInt64LE(64);
      }

      return {
        native:
          BigInt(native),
        tokens
      };
    },

    async create({
      name,
      symbol,
      uri
    }) {
      const owner =
        await wallet();

      const mintRentLamports =
        await connection
          .getMinimumBalanceForRentExemption(
            TINY_MINT_SIZE,
            'confirmed'
          );

      const built =
        buildTinyCreateInstructions({
          owner,
          programId:
            program(),
          name,
          symbol,
          uri,
          mintRentLamports
        });

      await send(
        built.instructions,
        [built.mintKeypair]
      );

      return built.mint
        .toBase58();
    },

    async trade(
      m,
      side,
      amount,
      min
    ) {
      const owner =
        await wallet();

      const mint =
        new PublicKey(
          m.token
        );

      if (
        m.id !==
        mint.toBase58()
      ) {
        throw Error(
          'Solana tiny market ID must equal its mint'
        );
      }

      const verified =
        await market(m.id);

      if (
        verified.token !==
        m.token
      ) {
        throw Error(
          'Market token changed; reload'
        );
      }

      const marketAddress =
        tinyMarketAddress(
          mint,
          program()
        );

      const instructions =
        tinyTradeInstructions({
          owner,
          mint,
          market:
            marketAddress,
          treasury:
            new PublicKey(
              config.treasury
            ),
          programId:
            program(),
          side,
          amount,
          min
        });

      return send(
        instructions
      );
    }
  };
}