import { publicLaunchRetryCache } from '../launch-retry.js';
import { readTinyMarketState } from '../solana-tiny-state.js';
import { snapshotTransaction, publicInstructionSequence, validateWalletTransaction } from '../solana-transaction-validation.js';
import { rentSupport, requireRentConsent } from '../solana-rent.js';
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
  TINY_SUPPLY,
  generateCompatibleMint,
  tinyAta,
  tinyMarketAddress,
  tinyMetadataAddress,
  buildTinyCreateInstructions,
  buildTinyFirstBuyerActivationInstructions,
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

  /*
   * Keep normal read fallback behavior separate from the real
   * transaction path.
   *
   * Every write-critical step uses PumpLite's reviewed RPC worker:
   * blockhash, rent lookup, fee lookup, pre-sign simulation,
   * post-sign simulation, broadcast and confirmation.
   *
   * This prevents a Phantom-approved purchase from being stopped
   * by a browser-blocked public Solana RPC endpoint.
   */
  const writeUrl =
    config.rpcUrl;

  const writeConnection =
    makeConnection(writeUrl);

  /*
   * Final broadcast uses the same reviewed PumpLite RPC worker as
   * the rest of the write-critical path.
   */
  const broadcastConnection =
    makeConnection(
      writeUrl
    );

  async function broadcastNetwork() {
    const hash =
      await broadcastConnection
        .getGenesisHash();

    assertSolanaMainnet(hash);
  }

  async function writeNetwork() {
    const hash =
      await writeConnection
        .getGenesisHash();

    assertSolanaMainnet(hash);
  }

  let preparedAt = 0;
  let preparedProvider;
  let connected;
  let selected;

  /*
   * Ephemeral first-buyer mint signers live only in this browser
   * adapter instance and are destroyed on disconnect/reload.
   */
  let retryStorage; try { retryStorage = globalThis.sessionStorage; } catch {}
  const launchDrafts = publicLaunchRetryCache(retryStorage);
  const localFirstBuyer =
    new Map();

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

    localFirstBuyer.clear();
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

  function connectedWallet() {
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

    return connected;
  }

  async function wallet() {
    const owner =
      connectedWallet();

    const attempt =
      revision;

    await network();

    if (
      attempt !== revision
    ) {
      throw Error(
        'Wallet changed or disconnected; reconnect'
      );
    }

    const current =
      connectedWallet();

    if (!current.equals(owner)) {
      throw Error(
        'Wallet changed or disconnected; reconnect'
      );
    }

    return current;
  }

  async function send(
    instructions,
    localSigners = [],
    beforeBroadcast = () => {}
  ) {
    const owner =
      await wallet();

    /*
     * Verify the dedicated broadcast endpoint is Solana Mainnet
     * before obtaining a blockhash or requesting a wallet signature.
     */
    await writeNetwork();

    const latest =
      await writeConnection
        .getLatestBlockhash(
          'confirmed'
        );

    const tx =
      new Transaction({
        feePayer: owner,
        ...latest
      })
        .add(...instructions);

    /*
     * IMPORTANT: do not apply browser-local signatures before
     * Phantom. This transaction can require both the Phantom buyer
     * and a disposable PumpLite mint signer.
     *
     * Phantom signs the wallet portion first. PumpLite adds the
     * browser-local mint signature only after Phantom returns the
     * verified transaction.
     */

    /*
     * Normalize the authored transaction through Solana wire format
     * before comparing it with Phantom's returned transaction.
     *
     * Wallets may recompile account metas when they prepend
     * Compute Budget instructions. This preserves the exact message
     * semantics while avoiding false per-instruction meta mismatches.
     */
    const original =
      Transaction.from(
        tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false
        })
      );

    const snapshot = snapshotTransaction(original);

    const preview = await writeConnection._rpcRequest('simulateTransaction', [tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'), {encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed'}]);
    if(preview.error || !preview.result?.value || preview.result.value.err !== null) throw Error('Pre-sign simulation failed: '+JSON.stringify(preview.error || preview.result?.value?.err || 'missing response'));

    // Refresh immediately before Phantom signs.
    const signingLatest =
      await writeConnection
        .getLatestBlockhash(
          'confirmed'
        );

    tx.recentBlockhash =
      signingLatest.blockhash;

    const signingOriginal =
      Transaction.from(
        tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false
        })
      );

    const signingSnapshot =
      snapshotTransaction(
        signingOriginal
      );
    notify(
      'Review and approve the PumpLite transaction in Phantom.'
    );

    /*
     * Phantom signs FIRST.
     *
     * For PumpLite coin activation the disposable mint signature
     * is added later, after the wallet-returned message has been
     * checked for unexpected changes.
     */
    const signed =
      await selected
        .signTransaction(tx);

    // Only public instruction metadata. No signatures, serialized transactions or secrets.
    const diagnostic = JSON.stringify({sameTransactionInstance:signed===tx,
      originalCount:signingSnapshot.instructions.length, returned:publicInstructionSequence(signed)});
    try {
      validateWalletTransaction(signingSnapshot, signed);
    } catch (error) {
      throw Error(error.message+'; Phantom public instruction sequence: '+diagnostic);
    }
    notify('Phantom public instruction sequence: '+diagnostic);

    /*
     * Phantom has signed first. Now apply only the disposable
     * browser-local mint signature to the exact wallet-approved
     * message. Phantom's wallet signature remains unchanged.
     */
    if (localSigners.length) {
      signed.partialSign(
        ...localSigners
      );
    }

    if (
      !signed.verifySignatures()
    ) {
      throw Error(
        'Wallet returned invalid signatures'
      );
    }

    notify(
      'Phantom approval received. PumpLite is verifying the fully signed transaction before broadcast.'
    );

    const fee =
      await writeConnection
        .getFeeForMessage(
          signed.compileMessage(),
          'confirmed'
        );

    if (
      !Number.isSafeInteger(
        fee.value
      ) ||
      fee.value > 200_000
    ) {
      throw Error(
        'Transaction fee exceeds PumpLite safety limit'
      );
    }

    const raw =
      signed.serialize();

    notify(
      'Signatures verified. Running final Solana simulation before broadcast.'
    );

    const simulation =
      await writeConnection
        ._rpcRequest(
          'simulateTransaction',
          [
            Buffer.from(raw)
              .toString('base64'),
            {
              encoding:
                'base64',
              sigVerify:
                true,
              replaceRecentBlockhash:
                false,
              commitment:
                'confirmed'
            }
          ]
        );

    if (simulation.error) {
      throw Error(
        'PumpLite simulation RPC error: ' +
        JSON.stringify(
          simulation.error
        )
      );
    }

    const sim =
      simulation.result?.value;

    if (
      !sim ||
      sim.err !== null
    ) {
      throw Error(
        'PumpLite simulation failed: ' +
        JSON.stringify(
          sim?.err ?? 'missing simulation result'
        )
      );
    }

    await wallet();

    const expectedSignature =
      signatureText(
        signed.signature
      );

    /*
     * Confirm the PumpLite broadcast relay is itself Mainnet before
     * sending the already fully-signed transaction.
     */
    await broadcastNetwork();

    notify(
      'Simulation passed. Broadcasting the signed PumpLite transaction to Solana Mainnet.',
      config.explorer +
      '/tx/' +
      expectedSignature
    );

    beforeBroadcast(expectedSignature);

    const signature =
      await broadcastConnection
        .sendRawTransaction(
          raw,
          {
            skipPreflight:
              false,
            preflightCommitment:
              'confirmed',
            maxRetries:
              5
          }
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

    try {
      const confirmation =
        await writeConnection
          .confirmTransaction(
            {
              signature,
              ...signingLatest
            },
            'confirmed'
          );

      assertSolanaConfirmation(
        confirmation
      );
    } catch (confirmationError) {
      notify(
        'Confirmation wait ended. Checking Solana directly before reporting failure.',
        config.explorer +
        '/tx/' +
        signature
      );

      let observedStatus =
        null;

      for (
        let round = 0;
        round < 3;
        round++
      ) {
        for (const rpcUrl of urls) {
          try {
            const statusConnection =
              makeConnection(
                rpcUrl
              );

            const statusGenesis =
              await statusConnection
                .getGenesisHash();

            assertSolanaMainnet(
              statusGenesis
            );

            const statusResponse =
              await statusConnection
                .getSignatureStatuses(
                  [signature],
                  {
                    searchTransactionHistory:
                      true
                  }
                );

            const candidate =
              statusResponse
                ?.value?.[0] ??
              null;

            if (!candidate) {
              continue;
            }

            observedStatus =
              candidate;

            if (
              candidate.err !==
              null
            ) {
              throw Error(
                'Solana transaction failed on-chain: ' +
                JSON.stringify(
                  candidate.err
                )
              );
            }

            if (
              candidate
                .confirmationStatus ===
                  'confirmed' ||
              candidate
                .confirmationStatus ===
                  'finalized'
            ) {
              notify(
                'Confirmed on Solana after final status check.',
                config.explorer +
                '/tx/' +
                signature
              );

              return signature;
            }
          } catch (statusError) {
            if (
              statusError?.message
                ?.startsWith(
                  'Solana transaction failed on-chain:'
                )
            ) {
              throw statusError;
            }
          }
        }

        if (round < 2) {
          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                1200
              )
          );
        }
      }

      if (observedStatus) {
        throw Error(
          'Transaction is visible on Solana with status ' +
          String(
            observedStatus
              .confirmationStatus ||
            'processed'
          ) +
          '. Do not retry; inspect the linked transaction.'
        );
      }

      throw Error(
        'Confirmation window ended and final Solana status is still unknown. ' +
        'Do not retry until the linked transaction is checked. Original error: ' +
        (
          confirmationError?.message ||
          'confirmation wait ended'
        )
      );
    }

    notify(
      'Confirmed on Solana.',
      config.explorer +
      '/tx/' +
      signature
    );

    return signature;
  }

  async function finalizeLaunchRegistry(
    launchId,
    signature,
    expected
  ) {
    const url =
      new URL(
        config.rpcUrl
      );

    url.pathname =
      "/launch/finalize";

    url.search = "";
    url.hash = "";

    const response =
      await boundedFetch(
        url,
        {
          method:
            "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify({
              launchId,
              signature
            })
        },
        {
          maxBytes:
            8192
        }
      );

    let reply;

    try {
      reply =
        await response.json();
    } catch {
      throw Error(
        "PumpLite activation finalizer returned invalid JSON"
      );
    }

    const activation =
      reply?.activation;

    if (
      !response.ok ||
      reply?.ok !== true ||
      activation?.launchId !==
        launchId ||
      activation?.mint !==
        expected.mint ||
      activation?.market !==
        expected.market ||
      activation?.buyer !==
        expected.buyer ||
      activation?.transactionSignature !==
        signature ||
      !Number.isSafeInteger(
        activation?.slot
      )
    ) {
      throw Error(
        reply?.error ||
        "PumpLite activation finalization failed"
      );
    }

    return activation;
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
            marketAddress,
            tinyAta(mint, marketAddress)
          ],
          'confirmed'
        );

    const [
      mintAccount,
      metadataAccount,
      marketAccount,
      vaultAccount
    ] = result.value;

    let rentFloor = 0n;
    if (mintAccount?.data.length === 82 && Buffer.from(mintAccount.data).readUInt32LE(0) === 0) {
      const rent = await connection.getMinimumBalanceForRentExemption(0, 'confirmed');
      if (!Number.isSafeInteger(rent) || rent <= 0) throw Error('Invalid Solana rent floor');
      rentFloor = BigInt(rent);
    }
    const chainState = readTinyMarketState({programId:program(), mint, market:marketAddress, mintAccount, marketAccount, vaultAccount, rentFloor});
    const {tokenReserve} = chainState;

    const identity =
      decodeMetadata(
        metadataAccount,
        mint
      );

    return {
      protocol: 'tiny',
      ...chainState,
      id: mint.toBase58(),
      token: mint.toBase58(),
      marketAddress:
        marketAddress.toBase58(),
      creator:
        identity.updateAuthority,
      name: identity.name,
      symbol: identity.symbol,
      uri: identity.uri,
      nativeReserve: chainState.nativeReserve,
      tokenReserve,
      volume: 0n,
      decimals: 6,
      nativeDecimals: 9,
      unit: 'SOL',
      virtualNative:
        30_000_000_000n,
      maximumSupply: SOL_SUPPLY,
      supply: chainState.mode === 'sealed' ? chainState.actualSupply : SOL_SUPPLY,
      source:
        (chainState.mode==='sealed' ? 'Sealed transfers · mint authority None · confirmed slot ' : 'Legacy curve · market PDA mint authority · confirmed slot ') +
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
        connectedWallet();

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

    async signMayhemMessage(
      message
    ) {
      if (
        typeof message !== 'string' ||
        enc.encode(message).length > 2048
      ) {
        throw Error(
          'Mayhem authorization message is invalid'
        );
      }

      const owner =
        connectedWallet();

      const attempt =
        revision;

      if (
        typeof selected?.signMessage !==
          'function'
      ) {
        throw Error(
          'This Solana wallet does not support message signing'
        );
      }

      notify(
        'Review the Mayhem authorization message. This signature does not spend SOL.'
      );

      const result =
        await selected.signMessage(
          enc.encode(message),
          'utf8'
        );

      if (
        attempt !== revision ||
        !selected?.publicKey?.equals(owner)
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

      return signature.toString(
        'base64'
      );
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

    async pendingLaunches(
      offset = 0
    ) {
      await network();

      if (
        !Number.isSafeInteger(
          offset
        ) ||
        offset < 0 ||
        offset % 8 !== 0
      ) {
        throw Error(
          "Invalid pending launch page"
        );
      }

      const url =
        new URL(
          config.rpcUrl
        );

      url.pathname =
        "/launch/pending/" +
        offset +
        ".json";

      url.search = "";
      url.hash = "";

      const response =
        await boundedFetch(
          url,
          {},
          {
            maxBytes:
              16_384
          }
        );

      let page;

      try {
        page =
          await response.json();
      } catch {
        throw Error(
          "PumpLite pending launch registry returned invalid JSON"
        );
      }

      if (
        !response.ok ||
        page?.schemaVersion !== 1 ||
        page?.programId !==
          program().toBase58() ||
        !Array.isArray(
          page.launches
        ) ||
        page.launches.length > 8 ||
        (
          page.next !== null &&
          (
            page.next !==
              offset + 8 ||
            page.launches.length !==
              8
          )
        )
      ) {
        throw Error(
          "Invalid PumpLite pending launch page"
        );
      }

      for (
        const launch of
          page.launches
      ) {
        if (
          typeof launch?.id !==
            "string" ||
          !/^[0-9a-f]{64}$/
            .test(launch.id) ||
          launch?.programId !==
            program().toBase58() ||
          launch?.status !==
            "pending" ||
          typeof launch?.creator !==
            "string" ||
          typeof launch?.name !==
            "string" ||
          typeof launch?.symbol !==
            "string"
        ) {
          throw Error(
            "Invalid PumpLite pending launch record"
          );
        }
      }

      return {
        launches:
          page.launches,
        next:
          page.next
      };
    },

    async retryFinalizeFirstBuyer({
      launchId
    }) {
      const buyer =
        await wallet();

      const local =
        localFirstBuyer.get(
          launchId
        );

      if (
        !local?.submitted ||
        local.submitted.buyer !==
          buyer.toBase58()
      ) {
        throw Error(
          "No submitted PumpLite activation is available in this browser"
        );
      }

      const activation =
        await finalizeLaunchRegistry(
          launchId,
          local.submitted
            .signature,
          {
            mint:
              local.submitted
                .mint,
            market:
              local.submitted
                .market,
            buyer:
              local.submitted
                .buyer
          }
        );

      local.finalized =
        activation;

      return activation;
    },

    market,

    async balances(m) {
      const owner =
        await wallet();

      const [native, accounts] = await Promise.all([
        connection.getBalance(owner),
        connection.getTokenAccountsByOwner(owner, {mint: new PublicKey(m.token)}, 'confirmed')
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

      for (const {account: info} of accounts.value) {
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

        tokens +=
          data.readBigUInt64LE(64);
      }

      return {
        native:
          BigInt(native),
        tokens
      };
    },

    async quote(
      m,
      side,
      input
    ) {
      if (
        !['buy', 'sell'].includes(
          side
        ) ||
        typeof input !== 'bigint' ||
        input <= 0n ||
        input >
          18_446_744_073_709_551_615n
      ) {
        throw Error(
          'Invalid PumpLite quote amount'
        );
      }

      const fresh =
        await market(
          m.id
        );

      const native =
        fresh.nativeReserve;

      const tokens =
        fresh.tokenReserve;

      const virtualNative =
        30_000_000_000n;

      if (side === 'buy') {
        const fee =
          input / 400n;

        const net =
          input - fee;

        const denominator =
          virtualNative +
          native +
          net;

        const output =
          tokens *
          net /
          denominator;

        if (output <= 0n) {
          throw Error(
            'Trade amount is too small'
          );
        }

        return {
          output,
          fee
        };
      }

      const denominator =
        tokens +
        input;

      const gross =
        (
          virtualNative +
          native
        ) *
        input /
        denominator;

      if (gross > native) {
        throw Error(
          'Insufficient PumpLite curve backing'
        );
      }

      const fee =
        gross / 400n;

      const output =
        gross - fee;

      if (output <= 0n) {
        throw Error(
          'Trade amount is too small'
        );
      }

      const rentValue = await connection.getMinimumBalanceForRentExemption(0, 'confirmed');
      if(!Number.isSafeInteger(rentValue)||rentValue<0)throw Error('Invalid Mainnet rent quote');
      const rentTopUp = rentSupport(native, gross, BigInt(rentValue));
      return { output, fee, rentTopUp, proceedsAfterRent: output-rentTopUp };
    },

    quoteFirstBuyerActivation(
      input
    ) {
      if (
        typeof input !== 'bigint' ||
        input <= 0n
      ) {
        throw Error(
          'Invalid first buyer amount'
        );
      }

      const fee =
        input / 400n;

      const net =
        input - fee;

      const denominator =
        30_000_000_000n +
        net;

      const output =
        TINY_SUPPLY *
        net /
        denominator;

      if (
        output <= 0n
      ) {
        throw Error(
          'First buyer amount is too small'
        );
      }

      return {
        output,
        fee
      };
    },

    async createFreeDraft({
      name,
      symbol,
      uri,
      mayhemMode = false
    }) {
      const owner =
        connectedWallet();

      if (
        typeof selected?.signMessage !==
        'function'
      ) {
        throw Error(
          'Phantom message signing is required for free PumpLite creation'
        );
      }

      const retryKey = JSON.stringify([program().toBase58(), owner.toBase58(), name, symbol, uri, mayhemMode]);
      const draft = await launchDrafts.get(retryKey, async () => {
      const nonceBytes =
        new Uint8Array(16);

      crypto.getRandomValues(
        nonceBytes
      );

      const nonce =
        Buffer.from(
          nonceBytes
        ).toString('hex');

      const createdAt =
        Date.now();

      const record = {
        version: 1,
        chain: 'solana',
        programId:
          program().toBase58(),
        creator:
          owner.toBase58(),
        name,
        symbol,
        uri,
        nonce,
        createdAt
      };

      const canonical =
        JSON.stringify(record);

      const message =
        'PumpLite Free Solana Launch\n' +
        'version=1\n' +
        canonical;

      notify(
        'Sign the free PumpLite launch message in Phantom. This is NOT a transaction and cannot spend SOL.'
      );

      const result =
        await selected.signMessage(
          enc.encode(message),
          'utf8'
        );

      const rawSignature =
        result?.signature ??
        result;

      let signature;

      try {
        signature =
          Buffer.from(
            rawSignature
          );
      } catch {
        throw Error(
          'Phantom returned an invalid launch signature'
        );
      }

      if (
        signature.length !== 64
      ) {
        throw Error(
          'Phantom returned an invalid launch signature'
        );
      }

      if (
        result?.publicKey &&
        !new PublicKey(
          result.publicKey
        ).equals(owner)
      ) {
        throw Error(
          'Phantom signed with a different wallet'
        );
      }

      const digest =
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            enc.encode(
              canonical
            )
          )
        );

      const id =
        Array.from(
          digest,
          byte =>
            byte
              .toString(16)
              .padStart(2, '0')
        ).join('');

      const draft = {
        ...record,
        id,
        message,
        signature:
          signature.toString(
            'base64'
          )
      };

      if (mayhemMode) {
        if (
          mayhemMode !== 'manual'
        ) {
          throw Error(
            'Unsupported Mayhem mode'
          );
        }

        const {
          signCreationChoice
        } =
          await import(
            '../mayhem-ui.js'
          );

        draft.mayhem =
          await signCreationChoice(
            draft,
            message =>
              this.signMayhemMessage(
                message
              )
          );
      }

      return draft;
      });
      const { id } = draft;
      if (draft.creator !== owner.toBase58() || draft.name !== name || draft.symbol !== symbol || draft.uri !== uri) throw Error('Saved launch identity mismatch');
      const launchUrl =
        new URL(
          config.rpcUrl
        );

      launchUrl.pathname =
        '/launch/register';

      launchUrl.search = '';
      launchUrl.hash = '';

      const response =
        await boundedFetch(
          launchUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json'
            },
            body:
              JSON.stringify(
                draft
              )
          },
          {
            maxBytes: 8192
          }
        );

      let reply;

      try {
        reply =
          await response.json();
      } catch {
        throw Error(
          'PumpLite launch registry returned an invalid response'
        );
      }

      if (
        !response.ok ||
        reply?.ok !== true ||
        reply?.id !== id ||
        reply?.launch?.creator !==
          owner.toBase58()
      ) {
        throw Error(
          'PumpLite launch registry rejected the signed launch'
        );
      }

      notify(
        'Free PumpLite launch published. Creator cost: 0 SOL. No Solana transaction was submitted.'
      );

      return draft;
    },

    async reserveFirstBuyer({
      launchId
    }) {
      const owner =
        connectedWallet();

      if (
        typeof launchId !==
          'string' ||
        !/^[0-9a-f]{64}$/
          .test(launchId)
      ) {
        throw Error(
          'Invalid PumpLite launch ID'
        );
      }

      if (
        typeof selected
          ?.signMessage !==
        'function'
      ) {
        throw Error(
          'Phantom message signing is required to prepare this coin purchase'
        );
      }

      let local =
        localFirstBuyer.get(
          launchId
        );

      if (!local) {
        const { assertMayhemReservationRecoverable } = await import('../mayhem-ui.js');
        await assertMayhemReservationRecoverable(launchId);

        local =
          generateCompatibleMint(
            program()
          );

        localFirstBuyer.set(
          launchId,
          local
        );
      }

      if (local.reservation?.buyer === owner.toBase58() && local.reservation.expiresAt > Date.now() + 15000) return {...local.reservation};
      const nonceBytes =
        new Uint8Array(16);

      crypto.getRandomValues(
        nonceBytes
      );

      const record = {
        version: 1,
        chain: 'solana',
        programId:
          program().toBase58(),
        launchId,
        mint:
          local.mint.toBase58(),
        market:
          local.market.toBase58(),
        buyer:
          owner.toBase58(),
        nonce:
          Buffer.from(
            nonceBytes
          ).toString('hex'),
        signedAt:
          Date.now()
      };

      const canonical =
        JSON.stringify(record);

      const message =
        'PumpLite Coin Purchase Preparation\n' +
        'version=1\n' +
        canonical;

      notify(
        'Sign the PumpLite coin purchase preparation message. This is NOT a transaction and cannot spend SOL.'
      );

      const signed =
        await selected.signMessage(
          enc.encode(message),
          'utf8'
        );

      const rawSignature =
        signed?.signature ??
        signed;

      const signature =
        Buffer.from(
          rawSignature
        );

      if (
        signature.length !== 64
      ) {
        throw Error(
          'Phantom returned an invalid reservation signature'
        );
      }

      if (
        signed?.publicKey &&
        !new PublicKey(
          signed.publicKey
        ).equals(owner)
      ) {
        throw Error(
          'Phantom signed the reservation with a different wallet'
        );
      }

      const body = {
        ...record,
        message,
        signature:
          signature.toString(
            'base64'
          )
      };

      /*
       * body contains PUBLIC reservation data only.
       * local.mintKeypair is never serialized or transmitted.
       */
      const url =
        new URL(
          config.rpcUrl
        );

      url.pathname =
        '/launch/reserve';

      url.search = '';
      url.hash = '';

      const response =
        await boundedFetch(
          url,
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify(body)
          },
          {
            maxBytes:
              8192
          }
        );

      let reply;

      try {
        reply =
          await response.json();
      } catch {
        throw Error(
          'PumpLite reservation service returned an invalid response'
        );
      }

      const reservation =
        reply?.reservation;

      if (
        !response.ok ||
        reply?.ok !== true ||
        reservation?.launchId !==
          launchId ||
        reservation?.mint !==
          record.mint ||
        reservation?.market !==
          record.market ||
        reservation?.buyer !==
          record.buyer ||
        !Number.isSafeInteger(
          reservation?.expiresAt
        )
      ) {
        throw Error(
          'PumpLite coin purchase preparation failed'
        );
      }

      local.reservation =
        reservation;

      notify(
        'Coin purchase prepared. No transaction has been submitted yet.'
      );

      return {
        launchId:
          reservation.launchId,

        mint:
          reservation.mint,

        market:
          reservation.market,

        buyer:
          reservation.buyer,

        expiresAt:
          reservation.expiresAt
      };
    },

    async activateReservedFirstBuyer({
      launchId,
      buyAmount,
      buyMinimum
    }) {
      if (
        config.transactionsEnabled !==
        true
      ) {
        throw Error(
          'PumpLite Solana Mainnet coin activation is still safety locked'
        );
      }

      const buyer =
        await wallet();

      const treasury =
        new PublicKey(
          config.treasury
        );

      if (
        typeof launchId !==
          'string' ||
        !/^[0-9a-f]{64}$/
          .test(launchId)
      ) {
        throw Error(
          'Invalid PumpLite launch ID'
        );
      }

      if (
        typeof buyAmount !==
          'bigint' ||
        buyAmount <= 0n ||
        typeof buyMinimum !==
          'bigint' ||
        buyMinimum <= 0n
      ) {
        throw Error(
          'Invalid coin purchase amount'
        );
      }

      const local =
        localFirstBuyer.get(
          launchId
        );

      if (
        !local ||
        !local.mintKeypair ||
        !local.reservation
      ) {
        throw Error(
          'Coin purchase preparation is not available in this browser. Prepare the purchase again.'
        );
      }

      if (local.submitted) {
        await this.retryFinalizeFirstBuyer({launchId});
        return {launchId, ...local.submitted};
      }
      const reservation =
        local.reservation;

      if (
        reservation.buyer !==
          buyer.toBase58() ||
        reservation.mint !==
          local.mint.toBase58() ||
        reservation.market !==
          local.market.toBase58()
      ) {
        throw Error(
          'Local coin purchase preparation changed'
        );
      }

      if (
        !Number.isSafeInteger(
          reservation.expiresAt
        ) ||
        reservation.expiresAt <=
          Date.now() + 15_000
      ) {
        throw Error(
          'Coin purchase preparation expired or is too close to expiry. Prepare the purchase again.'
        );
      }

      const launchUrl =
        new URL(
          config.rpcUrl
        );

      launchUrl.pathname =
        '/launch/' +
        launchId +
        '.json';

      launchUrl.search = '';
      launchUrl.hash = '';

      const response =
        await boundedFetch(
          launchUrl,
          {},
          {
            maxBytes:
              8192
          }
        );

      let payload;

      try {
        payload =
          await response.json();
      } catch {
        throw Error(
          'PumpLite launch registry returned invalid launch data'
        );
      }

      const launch =
        payload?.launch;

      if (
        !response.ok ||
        payload?.schemaVersion !== 1 ||
        payload?.programId !==
          program().toBase58() ||
        launch?.id !==
          launchId ||
        launch?.programId !==
          program().toBase58() ||
        launch?.status !==
          'pending'
      ) {
        throw Error(
          'PumpLite pending launch could not be verified'
        );
      }

      let creator;

      try {
        creator =
          new PublicKey(
            launch.creator
          );
      } catch {
        throw Error(
          'Invalid PumpLite launch creator'
        );
      }

      await writeNetwork();

      const mintRentLamports =
        await writeConnection
          .getMinimumBalanceForRentExemption(
            TINY_MINT_SIZE,
            'confirmed'
          );

      const built =
        buildTinyFirstBuyerActivationInstructions({
          buyer,
          creator,
          programId:
            program(),
          treasury,
          name:
            launch.name,
          symbol:
            launch.symbol,
          uri:
            launch.uri,
          mintRentLamports,
          buyAmount,
          buyMinimum,
          mintKeypair:
            local.mintKeypair
        });

      if (
        !built.mint.equals(
          local.mint
        ) ||
        !built.market.equals(
          local.market
        )
      ) {
        throw Error(
          'Reserved PumpLite mint changed during activation'
        );
      }

      /*
       * send() keeps the mint signature browser-local, asks Phantom
       * for the buyer signature, verifies Phantom did not change
       * PumpLite business instructions, performs sigVerify=true
       * Mainnet simulation, then broadcasts only if simulation passes.
       */
      const signature =
        await send(
          built.instructions,
          [
            local.mintKeypair
          ],
          signature => { local.submitted = {signature, mint: local.mint.toBase58(), market: local.market.toBase58(), buyer: buyer.toBase58()}; }
        );

      local.submitted = {
        signature,
        mint:
          built.mint.toBase58(),
        market:
          built.market.toBase58(),
        buyer:
          buyer.toBase58()
      };

      return {
        launchId,
        mint:
          built.mint.toBase58(),
        market:
          built.market.toBase58(),
        signature
      };
    },

    async create({
      name,
      symbol,
      uri,
      mayhemMode = false
    }) {
      if (mayhemMode) {
        throw Error(
          'Manual Mayhem must use the signed activation flow'
        );
      }

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
      min,
      _slippage,
      rentConsent
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

      if (verified.mode !== m.mode) throw Error('Market mode changed; reload before trading');
      const marketAddress = tinyMarketAddress(mint, program());

      const instructions =
        tinyTradeInstructions({
          mode: verified.mode,
          vault: verified.vault ? new PublicKey(verified.vault) : null,
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

      if(side==='sell') {
        const freshQuote = await this.quote(verified, side, amount);
        requireRentConsent(freshQuote.rentTopUp, min, rentConsent);
        if(freshQuote.rentTopUp>0n) instructions.push(SystemProgram.transfer({fromPubkey:owner,toPubkey:marketAddress,lamports:freshQuote.rentTopUp}));
      }
      return send(instructions);
    }
  };
}
