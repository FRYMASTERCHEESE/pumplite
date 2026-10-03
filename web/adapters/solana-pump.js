import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';

import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getTokenMetadata
} from '@solana/spl-token';

import {
  OnlinePumpSdk,
  PUMP_SDK,
  bondingCurvePda,
  getBuySolAmountFromTokenAmount,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount
} from '@pump-fun/pump-sdk';

import {
  OnlinePumpAmmSdk,
  PUMP_AMM_SDK,
  buyQuoteInput as quoteAmmBuy,
  canonicalPumpPoolPda,
  sellBaseInput as quoteAmmSell
} from '@pump-fun/pump-swap-sdk';

import BN from 'bn.js';
import { Buffer } from 'buffer';

import {
  solanaProvider,
  watchWallet
} from '../wallets.js';

import {
  signatureText
} from '../solana-signature.js';

import {
  boundedFetch
} from '../rpc-fetch.js';

import {
  assertSolanaMainnet
} from '../solana-network.js';

import {
  assertSolanaConfirmation
} from '../math.js';

if (!globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

const PUMP_PROGRAM =
  new PublicKey(
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
  );

const PUMP_AMM_PROGRAM =
  new PublicKey(
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
  );

const MAYHEM_PROGRAM =
  new PublicKey(
    'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e'
  );

const enc = new TextEncoder();

function toBigInt(value) {
  if (typeof value === 'bigint') {
    return value;
  }

  if (value === undefined || value === null) {
    return 0n;
  }

  return BigInt(value.toString());
}

function isSolQuote(curve) {
  const quote = curve?.quoteMint;

  return (
    !quote ||
    quote.equals?.(PublicKey.default) ||
    quote.equals?.(NATIVE_MINT)
  );
}

export function adapter(
  config,
  notify,
  changed = () => {}
) {
  assertSolanaMainnet(
    config.genesisHash
  );

  if (
    config.protocol !== 'pump' ||
    config.programId !==
      PUMP_PROGRAM.toBase58() ||
    config.ammProgramId !==
      PUMP_AMM_PROGRAM.toBase58() ||
    config.mayhemProgramId !==
      MAYHEM_PROGRAM.toBase58()
  ) {
    throw Error(
      'Unreviewed Pump Mainnet configuration'
    );
  }

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

  for (const raw of urls) {
    const url = new URL(raw);

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw Error(
        'Invalid Solana RPC URL'
      );
    }
  }

  let connection =
    makeConnection(urls[0]);

  const writeUrl =
    urls[1];

  if (!writeUrl) {
    throw Error(
      'A separate Solana Mainnet broadcast RPC is required'
    );
  }

  let writeConnection =
    makeConnection(writeUrl);

  let pump;
  let amm;

  let selected;
  let connected;
  let preparedProvider;
  let preparedAt = 0;
  let revision = 0;
  let unwatch = () => {};

  function refreshSdk() {
    pump =
      new OnlinePumpSdk(connection);

    amm =
      new OnlinePumpAmmSdk(connection);
  }

  function ensureSdk() {
    if (!pump || !amm) {
      refreshSdk();
    }
  }

  function disconnect() {
    revision++;

    selected = undefined;
    connected = undefined;
    preparedProvider = undefined;
    preparedAt = 0;

    unwatch();
    unwatch = () => {};

    changed();
  }

  async function network() {
    try {
      const genesis =
        await connection.getGenesisHash();

      assertSolanaMainnet(genesis);
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

      if (!other) {
        throw error;
      }

      notify(
        'Primary Solana RPC unavailable. Checking the reviewed fallback. No transaction is retried.'
      );

      const fallback =
        makeConnection(other);

      const genesis =
        await fallback.getGenesisHash();

      assertSolanaMainnet(genesis);

      connection = fallback;
      pump = undefined;
      amm = undefined;
    }

    const [
      pumpAccount,
      ammAccount,
      mayhemAccount
    ] =
      await Promise.all([
        connection.getAccountInfo(
          PUMP_PROGRAM,
          'confirmed'
        ),
        connection.getAccountInfo(
          PUMP_AMM_PROGRAM,
          'confirmed'
        ),
        connection.getAccountInfo(
          MAYHEM_PROGRAM,
          'confirmed'
        )
      ]);

    if (!pumpAccount?.executable) {
      throw Error(
        'Pump Mainnet program is not executable'
      );
    }

    if (!ammAccount?.executable) {
      throw Error(
        'PumpSwap Mainnet program is not executable'
      );
    }

    if (!mayhemAccount?.executable) {
      throw Error(
        'Pump Mayhem Mainnet program is not executable'
      );
    }
  }

  async function writeNetwork() {
    const hash =
      await writeConnection
        .getGenesisHash();

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
        'Wallet changed while verifying Mainnet; reconnect'
      );
    }

    return connected;
  }

  async function tokenProgram(mint) {
    const account =
      await connection.getAccountInfo(
        mint,
        'confirmed'
      );

    if (!account) {
      throw Error(
        'Token mint was not found'
      );
    }

    if (
      !account.owner.equals(
        TOKEN_PROGRAM_ID
      ) &&
      !account.owner.equals(
        TOKEN_2022_PROGRAM_ID
      )
    ) {
      throw Error(
        'Mint is not owned by SPL Token or Token-2022'
      );
    }

    return account.owner;
  }

  async function curveState(mint) {
    const address =
      bondingCurvePda(mint);

    const account =
      await connection.getAccountInfo(
        address,
        'confirmed'
      );

    if (!account) {
      throw Error(
        'This mint does not have a Pump bonding curve'
      );
    }

    const curve =
      PUMP_SDK.decodeBondingCurve(
        account
      );

    if (!isSolQuote(curve)) {
      throw Error(
        'PumpLite currently supports SOL-paired Pump coins only'
      );
    }

    return {
      address,
      account,
      curve
    };
  }

  async function identity(
    mint,
    program
  ) {
    if (
      program.equals(
        TOKEN_2022_PROGRAM_ID
      )
    ) {
      try {
        const metadata =
          await getTokenMetadata(
            connection,
            mint,
            'confirmed',
            TOKEN_2022_PROGRAM_ID
          );

        if (metadata) {
          return {
            name:
              String(
                metadata.name ||
                'Pump coin'
              ).replace(/\0+$/g, ''),
            symbol:
              String(
                metadata.symbol ||
                'PUMP'
              ).replace(/\0+$/g, ''),
            uri:
              String(
                metadata.uri || ''
              ).replace(/\0+$/g, '')
          };
        }
      } catch {
        // Market state remains usable even if metadata retrieval fails.
      }
    }

    const address =
      mint.toBase58();

    return {
      name:
        'Pump coin ' +
        address.slice(0, 5) +
        '…' +
        address.slice(-4),
      symbol: 'PUMP',
      uri: ''
    };
  }

  async function ammState(
    mint,
    user
  ) {
    ensureSdk();
    const pool =
      canonicalPumpPoolPda(
        mint
      );

    const state =
      await amm.swapSolanaState(
        pool,
        user
      );

    if (
      !state.pool.quoteMint.equals(
        NATIVE_MINT
      )
    ) {
      throw Error(
        'PumpLite currently supports SOL-paired canonical PumpSwap pools only'
      );
    }

    return {
      pool,
      state
    };
  }

  function ammQuoteArgs(state) {
    const {
      pool,
      poolBaseAmount,
      poolQuoteAmount,
      globalConfig,
      feeConfig,
      baseMint,
      baseMintAccount
    } = state;

    return {
      baseReserve:
        poolBaseAmount,
      quoteReserve:
        poolQuoteAmount,
      virtualQuoteReserves:
        pool.virtualQuoteReserves,
      globalConfig,
      feeConfig,
      baseMint,
      baseMintAccount,
      coinCreator:
        pool.coinCreator,
      creator:
        pool.creator,
      quoteMint:
        pool.quoteMint,
      isMayhemMode:
        pool.isMayhemMode,
      creatorFeeBps:
        pool.creatorFeeBps
    };
  }

  async function send(
    sdkInstructions,
    localSigners = [],
    computeUnits = 300_000
  ) {
    const owner =
      await wallet();

    if (
      !Array.isArray(
        sdkInstructions
      ) ||
      !sdkInstructions.length
    ) {
      throw Error(
        'No transaction instructions were produced'
      );
    }

    await writeNetwork();

    const latest =
      await writeConnection
        .getLatestBlockhash(
          'confirmed'
        );

    const instructions = [
      ComputeBudgetProgram
        .setComputeUnitLimit({
          units:
            computeUnits
        }),
      ComputeBudgetProgram
        .setComputeUnitPrice({
          microLamports:
            100_000
        }),
      ...sdkInstructions
    ];

    const message =
      new TransactionMessage({
        payerKey: owner,
        recentBlockhash:
          latest.blockhash,
        instructions
      })
        .compileToV0Message();

    const tx =
      new VersionedTransaction(
        message
      );

    if (localSigners.length) {
      tx.sign(localSigners);
    }

    const originalMessage =
      Buffer.from(
        tx.message.serialize()
      );

    const preserved =
      localSigners.map(
        signer => {
          const index =
            tx.message.staticAccountKeys
              .findIndex(
                key =>
                  key.equals(
                    signer.publicKey
                  )
              );

          if (index < 0) {
            throw Error(
              'Required local signer is not in the transaction'
            );
          }

          const signature =
            Buffer.from(
              tx.signatures[index]
            );

          if (
            !signature.some(
              byte => byte !== 0
            )
          ) {
            throw Error(
              'Required local signature is missing'
            );
          }

          return {
            index,
            signature
          };
        }
      );

    notify(
      'Checking this Pump transaction with Solana simulation before Phantom asks you to sign.'
    );

    const simulation =
      await writeConnection.simulateTransaction(
        tx,
        {
          sigVerify: false,
          commitment: 'confirmed'
        }
      );

    if (simulation.value.err) {
      const logs =
        simulation.value.logs
          ?.slice(-4)
          .join(' | ') ||
        'no simulation logs';

      throw Error(
        'Solana simulation rejected this transaction: ' +
        JSON.stringify(
          simulation.value.err
        ) +
        ' · ' +
        logs
      );
    }

    notify(
      'Simulation passed. Review the real Solana Mainnet transaction in Phantom before approving it.'
    );

    const signed =
      await selected.signTransaction(
        tx
      );

    if (
      !signed?.message ||
      !originalMessage.equals(
        Buffer.from(
          signed.message.serialize()
        )
      )
    ) {
      throw Error(
        'Wallet changed the transaction message'
      );
    }

    for (const item of preserved) {
      if (
        !item.signature.equals(
          Buffer.from(
            signed.signatures[
              item.index
            ]
          )
        )
      ) {
        throw Error(
          'Wallet removed or changed the required mint signature'
        );
      }
    }

    await wallet();
    await writeNetwork();

    const expected =
      signatureText(
        signed.signatures[0]
      );

    const explorer =
      config.explorer +
      '/tx/' +
      expected;

    notify(
      'Submitting your approved transaction to Solana Mainnet.',
      explorer
    );

    const actual =
      await writeConnection.sendRawTransaction(
        signed.serialize(),
        {
          skipPreflight: false,
          preflightCommitment:
            'confirmed',
          maxRetries: 2
        }
      );

    if (actual !== expected) {
      throw Error(
        'RPC returned an unexpected transaction signature'
      );
    }

    const confirmation =
      await writeConnection.confirmTransaction(
        {
          signature: actual,
          blockhash:
            latest.blockhash,
          lastValidBlockHeight:
            latest.lastValidBlockHeight
        },
        'confirmed'
      );

    assertSolanaConfirmation(
      confirmation
    );

    notify(
      'Confirmed on Solana Mainnet.',
      explorer
    );

    return actual;
  }

  async function market(id) {
    await network();

    const mint =
      new PublicKey(id);

    const [
      program,
      curveData,
      supply,
      slot
    ] =
      await Promise.all([
        tokenProgram(mint),
        curveState(mint),
        connection.getTokenSupply(
          mint,
          'confirmed'
        ),
        connection.getSlot(
          'confirmed'
        )
      ]);

    const identityData =
      await identity(
        mint,
        program
      );

    const {
      address,
      curve
    } = curveData;

    let marketAddress =
      address;

    let nativeReserve =
      toBigInt(
        curve.realSolReserves
      );

    let tokenReserve =
      toBigInt(
        curve.realTokenReserves
      );

    let virtualNative =
      toBigInt(
        curve.virtualSolReserves
      );

    let virtualTokens =
      toBigInt(
        curve.virtualTokenReserves
      );

    let creator =
      curve.creator
        ?.toBase58?.() ||
      config.treasury;

    let mayhem =
      Boolean(
        curve.isMayhemMode
      );

    const graduated =
      Boolean(
        curve.complete
      );

    if (graduated) {
      try {
        const readUser =
          new PublicKey(
            config.treasury
          );

        const {
          pool,
          state
        } =
          await ammState(
            mint,
            readUser
          );

        marketAddress =
          pool;

        nativeReserve =
          toBigInt(
            state.poolQuoteAmount
          );

        tokenReserve =
          toBigInt(
            state.poolBaseAmount
          );

        virtualNative =
          nativeReserve;

        virtualTokens =
          tokenReserve;

        creator =
          state.pool.coinCreator
            ?.toBase58?.() ||
          creator;

        mayhem =
          Boolean(
            state.pool.isMayhemMode
          );
      } catch {
        // During the migration window the curve can be complete before
        // the canonical PumpSwap pool becomes readable.
      }
    }

    return {
      protocol: 'pump',
      id:
        mint.toBase58(),
      token:
        mint.toBase58(),
      marketAddress:
        marketAddress.toBase58(),
      creator,
      name:
        identityData.name,
      symbol:
        identityData.symbol,
      uri:
        identityData.uri,
      nativeReserve,
      tokenReserve,
      volume: 0n,
      decimals:
        supply.value.decimals,
      nativeDecimals: 9,
      unit: 'SOL',
      virtualNative,
      pumpVirtualTokenReserves:
        virtualTokens,
      supply:
        BigInt(
          supply.value.amount
        ),
      graduated,
      mayhemActive:
        mayhem,
      launchedAt: 0,
      source:
        graduated
          ? 'Pump Mainnet · canonical PumpSwap'
          : 'Pump Mainnet · bonding curve',
      observedAt:
        Date.now(),
      provenance: {
        block: slot
      }
    };
  }

  async function quote(
    marketInfo,
    side,
    amount
  ) {
    ensureSdk();
    const user =
      await wallet();

    const mint =
      new PublicKey(
        marketInfo.token
      );

    const {
      curve
    } =
      await curveState(mint);

    const input =
      new BN(
        amount.toString()
      );

    if (curve.complete) {
      const {
        state
      } =
        await ammState(
          mint,
          user
        );

      const args =
        ammQuoteArgs(state);

      if (side === 'buy') {
        const result =
          quoteAmmBuy({
            ...args,
            quote: input,
            slippage: 0
          });

        return {
          input: amount,
          output:
            toBigInt(
              result.base
            ),
          fee: 0n,
          support: 0n,
          route:
            'PumpSwap'
        };
      }

      if (side === 'sell') {
        const result =
          quoteAmmSell({
            ...args,
            base: input,
            slippage: 0
          });

        return {
          input: amount,
          output:
            toBigInt(
              result.minQuote
            ),
          fee: 0n,
          support: 0n,
          route:
            'PumpSwap'
        };
      }

      throw Error(
        'Invalid trade side'
      );
    }

    const [
      global,
      feeConfig
    ] =
      await Promise.all([
        pump.fetchGlobal(),
        pump.fetchFeeConfig()
      ]);

    const mintSupply =
      curve.tokenTotalSupply;

    if (side === 'buy') {
      const tokens =
        getBuyTokenAmountFromSolAmount({
          global,
          feeConfig,
          mintSupply,
          bondingCurve:
            curve,
          amount:
            input
        });

      return {
        input: amount,
        output:
          toBigInt(tokens),
        fee: 0n,
        support: 0n,
        route:
          'Pump bonding curve'
      };
    }

    if (side === 'sell') {
      const sol =
        getSellSolAmountFromTokenAmount({
          global,
          feeConfig,
          mintSupply,
          bondingCurve:
            curve,
          amount:
            input
        });

      return {
        input: amount,
        output:
          toBigInt(sol),
        fee: 0n,
        support: 0n,
        route:
          'Pump bonding curve'
      };
    }

    throw Error(
      'Invalid trade side'
    );
  }

  return {
    disconnect,

    verifyNetwork:
      network,

    async prepareConnect() {
      preparedAt = 0;
      preparedProvider =
        undefined;

      const candidate =
        solanaProvider();

      if (!candidate) {
        throw Error(
          'No compatible Solana provider found. Open PumpLite inside Phantom.'
        );
      }

      preparedProvider =
        candidate;

      preparedAt =
        Date.now();

      notify(
        'Phantom detected. Tap Connect wallet again within 30 seconds. No transaction is requested.'
      );
    },

    async connect(
      prepared = false
    ) {
      const preparedAtBeforeDisconnect =
        preparedAt;

      const preparedProviderBeforeDisconnect =
        preparedProvider;

      disconnect();

      /*
       * connect(true) is the second half of the deliberate
       * two-tap Phantom flow.
       *
       * disconnect() resets stale wallet state, but must not
       * erase the preparation created by prepareConnect()
       * before that preparation is validated.
       */
      if (prepared) {
        preparedAt =
          preparedAtBeforeDisconnect;

        preparedProvider =
          preparedProviderBeforeDisconnect;
      }

      const attempt =
        revision;

      const candidate =
        solanaProvider();

      if (!candidate) {
        throw Error(
          'No Solana wallet detected. Open PumpLite inside Phantom.'
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
              'Phantom preparation expired. Tap Connect wallet again.'
            );
          }
        } else {
          await network();
        }

        preparedAt = 0;
        preparedProvider =
          undefined;

        notify(
          'Approve account access in Phantom. This does not spend SOL.'
        );

        let timer;

        const result =
          await Promise.race([
            candidate.connect(),
            new Promise(
              (_, reject) => {
                timer =
                  setTimeout(
                    () =>
                      reject(
                        Error(
                          'Phantom connection timed out after 60 seconds'
                        )
                      ),
                    60_000
                  );
              }
            )
          ]);

        clearTimeout(timer);

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
            'Phantom returned no matching public account'
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

        await wallet();

        notify(
          'Phantom connected. Pump Mainnet programs verified.'
        );

        return connected
          .toBase58();
      } catch (error) {
        if (
          attempt === revision
        ) {
          disconnect();
        }

        throw Error(
          'Solana connection failed: ' +
          (
            error?.message ||
            'unknown wallet error'
          )
        );
      }
    },

    async signMetadataMessage(
      message
    ) {
      if (
        typeof message !==
          'string' ||
        enc.encode(message).length >
          2048
      ) {
        throw Error(
          'Metadata authorization message is invalid'
        );
      }

      const owner =
        await wallet();

      if (
        typeof selected
          ?.signMessage !==
        'function'
      ) {
        throw Error(
          'This wallet does not support message signing'
        );
      }

      const attempt =
        revision;

      const result =
        await selected.signMessage(
          enc.encode(message),
          'utf8'
        );

      if (
        attempt !== revision ||
        !selected?.publicKey
          ?.equals(owner)
      ) {
        throw Error(
          'Wallet changed while signing metadata'
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
          'Wallet returned an invalid message signature'
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
        offset < 0
      ) {
        throw Error(
          'Invalid discovery page'
        );
      }

      // Exact mint links and all coins created through PumpLite are live.
      // A global Pump index is intentionally not fabricated from RPC.
      return {
        markets: [],
        next: null
      };
    },

    market,

    quote,

    async balances(
      marketInfo
    ) {
    ensureSdk();
      const owner =
        await wallet();

      const mint =
        new PublicKey(
          marketInfo.token
        );

      const program =
        await tokenProgram(mint);

      const [
        native,
        tokens
      ] =
        await Promise.all([
          connection.getBalance(
            owner,
            'confirmed'
          ),
          pump.getTokenBalance(
            mint,
            owner,
            program
          )
        ]);

      return {
        native:
          BigInt(native),
        tokens:
          toBigInt(tokens)
      };
    },

    async create({
      name,
      symbol,
      uri,
      mayhemMode = false
    }) {
      const owner =
        await wallet();

      const mint =
        Keypair.generate();

      const instruction =
        await PUMP_SDK
          .createV2Instruction({
            mint:
              mint.publicKey,
            name,
            symbol,
            uri,
            creator: owner,
            user: owner,
            mayhemMode:
              Boolean(
                mayhemMode
              ),
            holderReward:
              false
          });

      if (
        !instruction.programId
          .equals(
            PUMP_PROGRAM
          )
      ) {
        throw Error(
          'Pump SDK built a transaction for an unexpected program'
        );
      }

      await send(
        [instruction],
        [mint],
        350_000
      );

      return mint.publicKey
        .toBase58();
    },

    async trade(
      marketInfo,
      side,
      amount,
      _minimum,
      slippagePercent = 1
    ) {
    ensureSdk();
      const owner =
        await wallet();

      if (
        !Number.isFinite(
          slippagePercent
        ) ||
        slippagePercent < 0 ||
        slippagePercent > 50
      ) {
        throw Error(
          'Invalid slippage percentage'
        );
      }

      const mint =
        new PublicKey(
          marketInfo.token
        );

      const program =
        await tokenProgram(mint);

      const {
        account:
          bondingCurveAccountInfo,
        curve
      } =
        await curveState(mint);

      const input =
        new BN(
          amount.toString()
        );

      let instructions;

      if (curve.complete) {
        const {
          state
        } =
          await ammState(
            mint,
            owner
          );

        if (side === 'buy') {
          instructions =
            await PUMP_AMM_SDK
              .buyQuoteInput(
                state,
                input,
                slippagePercent
              );
        } else if (
          side === 'sell'
        ) {
          instructions =
            await PUMP_AMM_SDK
              .sellBaseInput(
                state,
                input,
                slippagePercent
              );
        } else {
          throw Error(
            'Invalid trade side'
          );
        }

        return send(
          instructions,
          [],
          300_000
        );
      }

      const [
        global,
        feeConfig
      ] =
        await Promise.all([
          pump.fetchGlobal(),
          pump.fetchFeeConfig()
        ]);

      const mintSupply =
        curve.tokenTotalSupply;

      if (side === 'buy') {
        const tokenAmount =
          getBuyTokenAmountFromSolAmount({
            global,
            feeConfig,
            mintSupply,
            bondingCurve:
              curve,
            amount:
              input
          });

        const solAmount =
          getBuySolAmountFromTokenAmount({
            global,
            feeConfig,
            mintSupply,
            bondingCurve:
              curve,
            amount:
              tokenAmount
          });

        const userAta =
          getAssociatedTokenAddressSync(
            mint,
            owner,
            false,
            program
          );

        const associatedUserAccountInfo =
          await connection
            .getAccountInfo(
              userAta,
              'confirmed'
            );

        instructions =
          await PUMP_SDK
            .buyInstructions({
              global,
              bondingCurveAccountInfo,
              bondingCurve:
                curve,
              associatedUserAccountInfo,
              mint,
              user: owner,
              amount:
                tokenAmount,
              solAmount,
              slippage:
                slippagePercent,
              tokenProgram:
                program
            });
      } else if (
        side === 'sell'
      ) {
        const solAmount =
          getSellSolAmountFromTokenAmount({
            global,
            feeConfig,
            mintSupply,
            bondingCurve:
              curve,
            amount:
              input
          });

        instructions =
          await PUMP_SDK
            .sellInstructions({
              global,
              bondingCurveAccountInfo,
              bondingCurve:
                curve,
              mint,
              user: owner,
              amount:
                input,
              solAmount,
              slippage:
                slippagePercent,
              tokenProgram:
                program,
              mayhemMode:
                curve.isMayhemMode ??
                false,
              cashback:
                curve.isCashbackCoin ??
                false
            });
      } else {
        throw Error(
          'Invalid trade side'
        );
      }

      return send(
        instructions,
        [],
        250_000
      );
    }
  };
}