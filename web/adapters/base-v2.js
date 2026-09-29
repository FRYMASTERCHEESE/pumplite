import { discoverEvm, watchWallet } from '../wallets.js';
import { BrowserProvider, JsonRpcProvider, Contract, getAddress, FetchRequest, AbiCoder, ZeroAddress, ZeroHash, keccak256, solidityPacked, toUtf8Bytes } from 'ethers';
import { gasBudget } from '../gas.js';
import { baseReadRpcUrls, baseReadTransport } from '../base-rpc.js';
import abis from '../generated/base-v2-abi.json' with { type: 'json' };
import { assertReceipt } from '../math.js';

export const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';
export const EAS_SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020';
export const PUMPLITE_REVIEW_SCHEMA = 'address market,address token,address creator,address factory,uint8 decision,bytes32 metadataHash,uint64 reviewedAt';
export const PUMPLITE_REVIEW_SCHEMA_UID = keccak256(
  solidityPacked(
    ['string', 'address', 'bool'],
    [PUMPLITE_REVIEW_SCHEMA, ZeroAddress, true]
  )
);

const REVIEW_DECISION = Object.freeze({ verified: 1, declined: 2 });
const REVIEW_DECISION_NAME = Object.freeze({ 1: 'verified', 2: 'declined' });
const reviewCoder = AbiCoder.defaultAbiCoder();
const SCHEMA_REGISTRY_ABI = [
  'function getSchema(bytes32 uid) view returns (tuple(bytes32 uid,address resolver,bool revocable,string schema) record)',
  'function register(string schema,address resolver,bool revocable) returns (bytes32)'
];
const HOLDER_CLAIM_ABI = [
  'function token() view returns (address)',
  'function CLAIM_AMOUNT() view returns (uint256)',
  'function MAX_CLAIMS() view returns (uint256)',
  'function claimCount() view returns (uint256)',
  'function remainingClaims() view returns (uint256)',
  'function claimed(address) view returns (bool)',
  'function claim()'
];
const EAS_ABI = [
  'function attest((bytes32 schema,(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value) data) request) payable returns (bytes32)',
  'function revoke((bytes32 schema,(bytes32 uid,uint256 value) data) request) payable',
  'function getAttestation(bytes32 uid) view returns (tuple(bytes32 uid,bytes32 schema,uint64 time,uint64 expirationTime,uint64 revocationTime,bytes32 refUID,address recipient,address attester,bool revocable,bytes data) attestation)',
  'event Attested(address indexed recipient,address indexed attester,bytes32 uid,bytes32 indexed schemaUID)'
];

function reviewMetadataHash(uri) {
  return keccak256(toUtf8Bytes(String(uri || '')));
}

function reviewDecisionCode(value) {
  const code = REVIEW_DECISION[value];
  if (!code) throw Error('Review decision must be verified or declined');
  return code;
}

export async function settleBase(tx, notify, explorer) {
  notify('Submitted. Waiting for a Base receipt.', explorer + '/tx/' + tx.hash);
  // Bound waiting, never resend automatically, and never silently accept a replacement.
  const receipt = await tx.wait(2, 120_000);
  assertReceipt(receipt);
  if (receipt.hash !== tx.hash) throw Error('Unexpected transaction receipt');
  notify('Confirmed on Base (2 confirmations).', explorer + '/tx/' + receipt.hash);
  return receipt;
}

export function adapter(config, notify, changed = () => {}) {
  if (config.chainId !== 8453) throw Error('Unsupported Base chain configuration');
  if (config.contractVersion !== 2) throw Error('Base V2 adapter requires contractVersion 2');
  const readRpcUrls = baseReadRpcUrls(config);
  const request = new FetchRequest(readRpcUrls[0]);
  request.timeout = 15000;
  request.setThrottleParams({ maxAttempts: 1 });

  let fallbackAnnounced = false;

  request.getUrlFunc = (req, signal) =>
    baseReadTransport(
      req,
      signal,
      readRpcUrls,
      () => {
        if (fallbackAnnounced) return;
        fallbackAnnounced = true;

        notify(
          'Primary Base read RPC is busy. Using the backup Base Mainnet read RPC. No wallet transaction was retried.'
        );
      }
    );

  const provider = new JsonRpcProvider(
    request,
    undefined,
    { batchMaxCount: 1 }
  );
  let walletProvider, signer, connectedAddress, selected, revision = 0, unwatch = () => {};
  function disconnect() {
    revision++; unwatch(); unwatch = () => {}; walletProvider?.destroy();
    walletProvider = undefined; signer = undefined; connectedAddress = undefined; selected = undefined; changed();
  }
  const factory = () => {
    if (!config.factory) throw Error('Base contracts have not been deployed');
    return new Contract(config.factory, abis.LaunchFactoryV2, provider);
  };
  const schemaRegistry = () =>
    new Contract(EAS_SCHEMA_REGISTRY_ADDRESS, SCHEMA_REGISTRY_ABI, provider);
  const eas = () =>
    new Contract(EAS_ADDRESS, EAS_ABI, provider);
  async function network() {
    const id = BigInt(await provider.send('eth_chainId', []));
    if (id !== 8453n) throw Error('RPC is not Base Mainnet');
  }
  async function wallet() {
    const attempt = revision;
    if (!signer) throw Error('Connect your wallet first');
    if (BigInt(await selected.request({ method: 'eth_chainId' })) !== 8453n) throw Error('Wallet must be on Base Mainnet');
    const accounts = await selected.request({ method: 'eth_accounts' });
    if (!accounts[0] || getAddress(accounts[0]) !== connectedAddress) throw Error('Wallet changed; reconnect');
    await network();
    if (attempt !== revision || !signer) throw Error('Wallet changed; reconnect');
    return signer;
  }
  const settle = tx => settleBase(tx, notify, config.explorer);
  async function market(id) {
    await network();
    const blockTag = await provider.getBlockNumber();
    if (!await factory().isMarket(id, { blockTag })) throw Error('Market is not in the configured factory');
    const curve = new Contract(id, abis.CurveMarketV2, provider);
    const [
      tokenAddress,
      nativeReserve,
      tokenReserve,
      volume,
      creator,
      treasury,
      uri,
      initialSupply,
      initialMayhem,
      manualMayhem,
      mayhemActive,
      launchedAt,
      totalMarketSupport,
      totalBurned,
      mayhemController
    ] = await Promise.all([
      curve.token({ blockTag }),
      curve.nativeReserve({ blockTag }),
      curve.tokenReserve({ blockTag }),
      curve.volume({ blockTag }),
      curve.creator({ blockTag }),
      curve.treasury({ blockTag }),
      curve.metadataURI({ blockTag }),
      curve.initialSupply({ blockTag }),
      curve.initialMayhem({ blockTag }),
      curve.manualMayhem({ blockTag }),
      curve.mayhemActive({ blockTag }),
      curve.launchedAt({ blockTag }),
      curve.totalMarketSupport({ blockTag }),
      curve.totalBurned({ blockTag }),
      curve.mayhemController({ blockTag })
    ]);

    if (getAddress(treasury) !== getAddress(config.treasury)) {
      throw Error('Unexpected platform treasury');
    }

    const token = new Contract(tokenAddress, abis.LaunchTokenV2, provider);

    const [
      name,
      symbol,
      supply,
      maxSupply,
      mintableAtLaunch,
      mintingLocked,
      totalMinted,
      remainingMintAllowance
    ] = await Promise.all([
      token.name({ blockTag }),
      token.symbol({ blockTag }),
      token.totalSupply({ blockTag }),
      token.maxSupply({ blockTag }),
      token.mintableAtLaunch({ blockTag }),
      token.mintingLocked({ blockTag }),
      token.totalMinted({ blockTag }),
      token.remainingMintAllowance({ blockTag })
    ]);

    return {
      id: getAddress(id),
      token: getAddress(tokenAddress),
      creator: getAddress(creator),
      mayhemController: getAddress(mayhemController),
      name,
      symbol,
      uri,
      nativeReserve,
      tokenReserve,
      volume,
      initialSupply,
      supply,
      maxSupply,
      mintableAtLaunch,
      mintingLocked,
      totalMinted,
      remainingMintAllowance,
      initialMayhem,
      manualMayhem,
      mayhemActive,
      launchedAt,
      totalMarketSupport,
      totalBurned,
      contractVersion: 2,
      provenance: {
        registered: true,
        chainId: 8453,
        factory: getAddress(config.factory),
        market: getAddress(id),
        block: blockTag
      },
      decimals: 18,
      nativeDecimals: 18,
      unit: 'ETH',
      virtualNative: 10n ** 18n,
      source: 'Base V2 block ' + blockTag,
      observedAt: Date.now()
    };
  }
  function holderClaimConfig() {
    const value = config.holderClaim;

    if (
      !value ||
      value.enabled !== true ||
      typeof value.contract !== 'string'
    ) {
      return null;
    }

    return value;
  }

  async function holderClaimStatus() {
    const value = holderClaimConfig();

    if (!value) {
      return {
        enabled: false,
        claimed: null,
        claimCount: 0n,
        remaining: 0n,
        maxClaims: 50n,
        claimAmount: 10n ** 18n
      };
    }

    await network();

    const claim = new Contract(
      value.contract,
      HOLDER_CLAIM_ABI,
      provider
    );

    const [
      tokenAddress,
      claimAmount,
      maxClaims,
      claimCount,
      remaining
    ] = await Promise.all([
      claim.token(),
      claim.CLAIM_AMOUNT(),
      claim.MAX_CLAIMS(),
      claim.claimCount(),
      claim.remainingClaims()
    ]);

    if (
      getAddress(tokenAddress) !==
      getAddress(value.token)
    ) {
      throw Error(
        'Holder claim contract points to an unexpected token'
      );
    }

    let alreadyClaimed = null;

    if (connectedAddress) {
      alreadyClaimed =
        await claim.claimed(connectedAddress);
    }

    return {
      enabled: true,
      contract: getAddress(value.contract),
      token: getAddress(tokenAddress),
      claimAmount,
      maxClaims,
      claimCount,
      remaining,
      claimed: alreadyClaimed
    };
  }

  async function claimHolderToken() {
    const value = holderClaimConfig();

    if (!value) {
      throw Error('PLITE holder claim is not open yet');
    }

    const active = await wallet();
    const before = await holderClaimStatus();

    if (before.claimed) {
      throw Error('This wallet already claimed PLITE');
    }

    if (before.remaining <= 0n) {
      throw Error('All 50 PLITE holder claims are already taken');
    }

    const claim = new Contract(
      value.contract,
      HOLDER_CLAIM_ABI,
      active
    );

    const gas =
      await claim.claim.estimateGas();

    const gasLimit =
      gasBudget(gas, 200_000n);

    notify(
      'Review the PLITE claim in your wallet. The token itself is free; Base network gas may apply.'
    );

    await wallet();
    await settle(
      await claim.claim({ gasLimit })
    );

    return holderClaimStatus();
  }
  return {
    disconnect,
    holderClaimStatus,
    claimHolderToken,
    close() { disconnect(); provider.destroy(); },
    async connect(candidate) {
      disconnect();
      if (!candidate) {
        const discovery = discoverEvm();
        const choices = discovery.refresh(); discovery.dispose();
        if (choices.length > 1) throw Error('Choose an EVM wallet before connecting');
        candidate = choices[0]?.provider;
      }
      if (typeof candidate?.request !== 'function') throw Error('No EVM wallet detected. Open this page in Coinbase Wallet or another wallet browser.');
      selected = candidate;
      const attempt = revision;
      unwatch = watchWallet(candidate, ['disconnect'], disconnect);
      try {
        await network();
        if (attempt !== revision) throw Error('Wallet changed; reconnect');
        await candidate.request({ method: 'eth_requestAccounts' });
        if (attempt !== revision) throw Error('Wallet changed; reconnect');
        if (BigInt(await candidate.request({ method: 'eth_chainId' })) !== 8453n) {
          await candidate.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
        }
        if (attempt !== revision) throw Error('Wallet changed; reconnect');
        if (BigInt(await candidate.request({ method: 'eth_chainId' })) !== 8453n) throw Error('Wallet must be on Base Mainnet');
        unwatch(); unwatch = watchWallet(candidate, ['disconnect', 'accountsChanged', 'chainChanged'], disconnect);
        walletProvider = new BrowserProvider(candidate);
        const nextSigner = await walletProvider.getSigner();
        const address = await nextSigner.getAddress();
        if (attempt !== revision) throw Error('Wallet changed; reconnect');
        signer = nextSigner; connectedAddress = address;
        await wallet();
        if (attempt !== revision) throw Error('Wallet changed; reconnect');
        return connectedAddress;
      } catch (error) { if (attempt === revision) disconnect(); throw error; }
    },
    async signMetadataMessage(message) {
      const bytes = new TextEncoder().encode(message);

      if (
        typeof message !== 'string' ||
        bytes.length > 2048
      ) {
        throw Error('Metadata authorization message is invalid');
      }

      const active = await wallet();
      const attempt = revision;

      notify(
        'Review the metadata authorization message. This signature does not spend ETH.'
      );

      const hexMessage =
        '0x' +
        Array.from(
          bytes,
          value => value.toString(16).padStart(2, '0')
        ).join('');

      const rejected = error =>
        error?.code === 4001 ||
        error?.code === 'ACTION_REJECTED' ||
        /user rejected|user denied|rejected the request/i.test(
          error?.shortMessage || error?.message || ''
        );

      let signature;
      let firstError;

      try {
        signature = await selected.request({
          method: 'personal_sign',
          params: [
            hexMessage,
            connectedAddress
          ]
        });
      } catch (error) {
        if (rejected(error)) throw error;
        firstError = error;
      }

      if (!signature) {
        try {
          // A small number of injected mobile providers expose the
          // historical reversed personal_sign parameter order.
          signature = await selected.request({
            method: 'personal_sign',
            params: [
              connectedAddress,
              hexMessage
            ]
          });
        } catch (error) {
          if (rejected(error)) throw error;

          try {
            // Final standards-compatible fallback through ethers.
            signature = await active.signMessage(message);
          } catch (fallbackError) {
            if (rejected(fallbackError)) throw fallbackError;
            throw firstError || error || fallbackError;
          }
        }
      }

      if (
        attempt !== revision ||
        !signer
      ) {
        throw Error(
          'Wallet changed while signing; reconnect'
        );
      }

      if (
        typeof signature !== 'string' ||
        !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) ||
        signature.length > 1026
      ) {
        throw Error(
          'Wallet returned an invalid Base signature'
        );
      }

      return signature;
    },

    async list(offset = 0) {
      await network();
      const count = Number(await factory().marketCount());
      const end = Math.max(0, count - offset);
      const start = Math.max(0, end - 8);
      const ids = await Promise.all(Array.from({ length: end - start }, (_, i) => factory().markets(end - i - 1)));
      return { markets: await Promise.all(ids.map(market)), next: start > 0 ? offset + 8 : null };
    },
    market,
    async balances(m) {
      await wallet();
      const token = new Contract(m.token, abis.LaunchTokenV2, provider);
      const [native, tokens] = await Promise.all([provider.getBalance(connectedAddress), token.balanceOf(connectedAddress)]);
      return { native, tokens };
    },
    async create({
      name,
      symbol,
      uri,
      initialSupply,
      maxSupply,
      mintable,
      initialMayhem
    }) {
      if (
        typeof initialSupply !== 'bigint' ||
        typeof maxSupply !== 'bigint' ||
        initialSupply <= 0n ||
        maxSupply < initialSupply
      ) throw Error('Invalid V2 supply configuration');

      await wallet();

      const readFactory = factory();

      const launchConfig = {
        name,
        symbol,
        uri,
        initialSupply,
        maxSupply,
        mintable: mintable === true,
        initialMayhem: initialMayhem === true
      };

      // Estimate through the reviewed Base RPC, not the wallet provider.
      // Some mobile EVM wallets reject a zero-native-value contract
      // estimation as though it were a zero-amount transfer. Token
      // creation is nonpayable, so the transaction must not include value.
      const data =
        readFactory.interface.encodeFunctionData(
          'createMarketV2',
          [launchConfig]
        );

      const gas = await provider.estimateGas({
        from: connectedAddress,
        to: config.factory,
        data
      });

      const gasLimit = gasBudget(gas, 5_000_000n);

      notify(
        'Estimated V2 creation gas: ' +
        gas +
        '. Review the wallet fee before approving.'
      );

      const activeSigner = await wallet();

      const receipt = await settle(
        await activeSigner.sendTransaction({
          to: config.factory,
          data,
          gasLimit
        })
      );

      for (const log of receipt.logs) {
        if (getAddress(log.address) !== getAddress(config.factory)) continue;

        try {
          const parsed = readFactory.interface.parseLog(log);
          if (parsed?.name === 'MarketCreatedV2') return parsed.args.market;
        } catch {}
      }

      throw Error('Confirmed V2 transaction has no expected factory event');
    },
    async buyAndBurn(m, amount, min) {
      if (amount <= 0n || min <= 0n) throw Error('Invalid Buy & Burn parameters');

      const s = await wallet();
      const verified = await market(m.id);
      const curve = new Contract(verified.id, abis.CurveMarketV2, s);

      const block = await provider.getBlock('latest');
      const deadline = BigInt(block.timestamp + 180);

      const gas = await curve.buyAndBurn.estimateGas(
        min,
        deadline,
        { value: amount }
      );

      const gasLimit = gasBudget(gas, 300_000n);

      await wallet();

      return settle(
        await curve.buyAndBurn(min, deadline, {
          value: amount,
          gasLimit
        })
      );
    },

    async mintInventory(m, amount) {
      if (amount <= 0n) throw Error('Invalid mint amount');

      const s = await wallet();
      const verified = await market(m.id);
      const curve = new Contract(verified.id, abis.CurveMarketV2, s);

      const gas = await curve.mintInventory.estimateGas(amount);
      const gasLimit = gasBudget(gas, 250_000n);

      await wallet();

      return settle(
        await curve.mintInventory(amount, { gasLimit })
      );
    },

    async lockMinting(m) {
      const s = await wallet();
      const verified = await market(m.id);
      const curve = new Contract(verified.id, abis.CurveMarketV2, s);

      const gas = await curve.lockMintingForever.estimateGas();
      const gasLimit = gasBudget(gas, 150_000n);

      await wallet();

      return settle(
        await curve.lockMintingForever({ gasLimit })
      );
    },

    async setMayhem(m, enabled) {
      const s = await wallet();
      const verified = await market(m.id);

      if (
        getAddress(connectedAddress) !==
        getAddress(verified.mayhemController)
      ) {
        throw Error('Connected wallet is not the Mayhem controller');
      }

      const block = await provider.getBlock('latest');
      const unlockAt =
        BigInt(verified.launchedAt) + 86_400n;

      if (BigInt(block.timestamp) < unlockAt) {
        throw Error(
          'Manual Mayhem unlocks 24 hours after launch. This is enforced by the deployed market contract.'
        );
      }

      const curve = new Contract(
        verified.id,
        abis.CurveMarketV2,
        s
      );

      const gas =
        await curve.setMayhem.estimateGas(enabled);
      const gasLimit =
        gasBudget(gas, 150_000n);

      await wallet();

      return settle(
        await curve.setMayhem(enabled, { gasLimit })
      );
    },

    async supportMarket(m, amount) {
      if (amount <= 0n) throw Error('Invalid support amount');

      const s = await wallet();
      const verified = await market(m.id);
      const curve = new Contract(verified.id, abis.CurveMarketV2, s);

      const gas = await curve.supportMarket.estimateGas({ value: amount });
      const gasLimit = gasBudget(gas, 150_000n);

      await wallet();

      return settle(
        await curve.supportMarket({
          value: amount,
          gasLimit
        })
      );
    },

    reviewSchemaUid() {
      return PUMPLITE_REVIEW_SCHEMA_UID;
    },

    async reviewSchemaStatus() {
      await network();
      const record = await schemaRegistry().getSchema(PUMPLITE_REVIEW_SCHEMA_UID);
      const registered = record.uid !== ZeroHash;

      if (!registered) {
        return {
          registered: false,
          uid: PUMPLITE_REVIEW_SCHEMA_UID,
          schema: PUMPLITE_REVIEW_SCHEMA
        };
      }

      const matches =
        record.uid === PUMPLITE_REVIEW_SCHEMA_UID &&
        getAddress(record.resolver) === getAddress(ZeroAddress) &&
        record.revocable === true &&
        record.schema === PUMPLITE_REVIEW_SCHEMA;

      if (!matches) {
        throw Error('PumpLite EAS schema UID exists with unexpected schema data');
      }

      return {
        registered: true,
        uid: PUMPLITE_REVIEW_SCHEMA_UID,
        schema: PUMPLITE_REVIEW_SCHEMA
      };
    },

    async registerReviewSchema() {
      const active = await wallet();

      if (getAddress(connectedAddress) !== getAddress(config.treasury)) {
        throw Error('Only the PumpLite controller wallet can register the review schema from this site');
      }

      const existing = await this.reviewSchemaStatus();
      if (existing.registered) return existing;

      const registry = new Contract(
        EAS_SCHEMA_REGISTRY_ADDRESS,
        SCHEMA_REGISTRY_ABI,
        active
      );

      const gas = await registry.register.estimateGas(
        PUMPLITE_REVIEW_SCHEMA,
        ZeroAddress,
        true
      );
      const gasLimit = gasBudget(gas, 500_000n);

      notify(
        'Registering the PumpLite review schema on Base EAS. This is a one-time Base transaction and uses network gas.'
      );

      await wallet();
      await settle(
        await registry.register(
          PUMPLITE_REVIEW_SCHEMA,
          ZeroAddress,
          true,
          { gasLimit }
        )
      );

      const checked = await this.reviewSchemaStatus();
      if (!checked.registered) throw Error('EAS schema registration was not visible after confirmation');
      return checked;
    },

    async reviewAttestation(uid) {
      if (typeof uid !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(uid)) {
        throw Error('Invalid EAS attestation UID');
      }

      await network();
      const attestation = await eas().getAttestation(uid);

      if (attestation.uid === ZeroHash) {
        throw Error('EAS attestation was not found');
      }

      let decoded;
      try {
        decoded = reviewCoder.decode(
          ['address','address','address','address','uint8','bytes32','uint64'],
          attestation.data
        );
      } catch {
        throw Error('EAS attestation data does not match the PumpLite review schema');
      }

      const decisionCode = Number(decoded[4]);
      const decision = REVIEW_DECISION_NAME[decisionCode] || 'unknown';
      const expiration = BigInt(attestation.expirationTime);
      const now = BigInt(Math.floor(Date.now() / 1000));

      return {
        uid: attestation.uid,
        schema: attestation.schema,
        recipient: getAddress(attestation.recipient),
        attester: getAddress(attestation.attester),
        time: BigInt(attestation.time),
        expirationTime: expiration,
        revocationTime: BigInt(attestation.revocationTime),
        revocable: Boolean(attestation.revocable),
        market: getAddress(decoded[0]),
        token: getAddress(decoded[1]),
        creator: getAddress(decoded[2]),
        factory: getAddress(decoded[3]),
        decisionCode,
        decision,
        metadataHash: decoded[5],
        reviewedAt: BigInt(decoded[6]),
        active:
          attestation.schema === PUMPLITE_REVIEW_SCHEMA_UID &&
          BigInt(attestation.revocationTime) === 0n &&
          (expiration === 0n || expiration > now)
      };
    },

    async publishReviewAttestation(m, decision) {
      const active = await wallet();
      const owner = getAddress(config.treasury);

      if (getAddress(connectedAddress) !== owner) {
        throw Error('Only the PumpLite controller wallet can publish PumpLite review attestations');
      }

      const verified = await market(m.id);
      const schema = await this.reviewSchemaStatus();
      if (!schema.registered) {
        throw Error('Register the PumpLite review schema on Base first');
      }

      const code = reviewDecisionCode(decision);
      const block = await provider.getBlock('latest');
      const reviewedAt = BigInt(block.timestamp);
      const data = reviewCoder.encode(
        ['address','address','address','address','uint8','bytes32','uint64'],
        [
          verified.id,
          verified.token,
          verified.creator,
          getAddress(config.factory),
          code,
          reviewMetadataHash(verified.uri),
          reviewedAt
        ]
      );

      const requestData = {
        recipient: verified.token,
        expirationTime: 0,
        revocable: true,
        refUID: ZeroHash,
        data,
        value: 0
      };

      const easWrite = new Contract(EAS_ADDRESS, EAS_ABI, active);
      const gas = await easWrite.attest.estimateGas({
        schema: PUMPLITE_REVIEW_SCHEMA_UID,
        data: requestData
      });
      const gasLimit = gasBudget(gas, 500_000n);

      notify(
        'Publishing a public PumpLite ' + decision + ' review attestation on Base EAS. Review the wallet network fee before approving.'
      );

      await wallet();
      const receipt = await settle(
        await easWrite.attest(
          {
            schema: PUMPLITE_REVIEW_SCHEMA_UID,
            data: requestData
          },
          { gasLimit }
        )
      );

      let uid = null;
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== getAddress(EAS_ADDRESS)) continue;
        try {
          const parsed = easWrite.interface.parseLog(log);
          if (parsed?.name === 'Attested') {
            uid = parsed.args.uid;
            break;
          }
        } catch {}
      }

      if (!uid) throw Error('Confirmed EAS transaction did not contain the expected Attested event');

      const proof = await this.reviewAttestation(uid);
      if (
        !proof.active ||
        proof.decision !== decision ||
        getAddress(proof.attester) !== owner ||
        getAddress(proof.market) !== getAddress(verified.id) ||
        getAddress(proof.token) !== getAddress(verified.token) ||
        getAddress(proof.creator) !== getAddress(verified.creator) ||
        getAddress(proof.factory) !== getAddress(config.factory) ||
        proof.metadataHash !== reviewMetadataHash(verified.uri)
      ) {
        throw Error('Published EAS attestation failed the PumpLite read-back checks');
      }

      return proof;
    },

    async revokeReviewAttestation(uid) {
      const active = await wallet();
      const owner = getAddress(config.treasury);
      if (getAddress(connectedAddress) !== owner) {
        throw Error('Only the PumpLite controller wallet can revoke PumpLite review attestations');
      }

      const proof = await this.reviewAttestation(uid);
      if (getAddress(proof.attester) !== owner) {
        throw Error('This attestation was not issued by the PumpLite controller wallet');
      }
      if (!proof.active) throw Error('This PumpLite review attestation is already inactive');
      if (!proof.revocable) throw Error('This EAS attestation is not revocable');

      const easWrite = new Contract(EAS_ADDRESS, EAS_ABI, active);
      const request = {
        schema: PUMPLITE_REVIEW_SCHEMA_UID,
        data: { uid, value: 0 }
      };
      const gas = await easWrite.revoke.estimateGas(request);
      const gasLimit = gasBudget(gas, 250_000n);

      notify('Revoking the public PumpLite EAS review attestation. This uses Base network gas.');
      await wallet();
      await settle(await easWrite.revoke(request, { gasLimit }));

      const after = await this.reviewAttestation(uid);
      if (after.revocationTime === 0n) throw Error('EAS revocation was not visible after confirmation');
      return after;
    },

    async tradeHistory(m, limit = 120) {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 200
      ) {
        throw Error('Invalid trade history limit');
      }

      await network();

      const id = getAddress(m.id);

      if (!await factory().isMarket(id)) {
        throw Error('Market is not in the configured factory');
      }

      const curve = new Contract(
        id,
        abis.CurveMarketV2,
        provider
      );

      const latest =
        await provider.getBlockNumber();

      let to = latest;
      let logs = [];

      // Recent chart history only. Read-only log queries are deliberately
      // bounded so a chart can never create an unbounded RPC scan.
      for (
        let chunk = 0;
        chunk < 20 && to >= 0 && logs.length < limit;
        chunk++
      ) {
        const from = Math.max(0, to - 4_999);
        const batch = await curve.queryFilter(
          curve.filters.Trade(),
          from,
          to
        );

        logs.push(...batch);

        if (from === 0) break;
        to = from - 1;
      }

      logs.sort(
        (a, b) =>
          Number(a.blockNumber) -
          Number(b.blockNumber)
      );

      if (logs.length > limit) {
        logs = logs.slice(-limit);
      }

      return logs.map(log => {
        const isBuy = Boolean(log.args.isBuy);
        const input = BigInt(log.args.input);
        const output = BigInt(log.args.output);

        const price =
          isBuy
            ? input * 10n ** 18n / output
            : output * 10n ** 18n / input;

        return {
          blockNumber: Number(log.blockNumber),
          transactionHash: log.transactionHash,
          isBuy,
          input,
          output,
          price
        };
      });
    },

    async trade(m, side, amount, min) {
      if (!['buy', 'sell'].includes(side) || amount <= 0n || min <= 0n) throw Error('Invalid trade parameters');
      const s = await wallet();
      // Validate registry again immediately before interacting.
      const verified = await market(m.id);
      if (getAddress(verified.token) !== getAddress(m.token)) throw Error('Market token changed; reload');
      const curve = new Contract(verified.id, abis.CurveMarketV2, s);
      if (side === 'sell') {
        const token = new Contract(verified.token, abis.LaunchTokenV2, s);
        if (await token.allowance(connectedAddress, m.id) < amount) {
          notify('Approve only the exact token amount. A separate sell signature follows.');
          await wallet();
          await settle(await token.approve(verified.id, amount));
          await wallet();
        }
      }
      const block = await provider.getBlock('latest');
      const deadline = BigInt(block.timestamp + 180);
      await wallet();
      const method = side === 'buy' ? curve.buy : curve.sell;
      const args = side === 'buy' ? [min, deadline] : [amount, min, deadline];
      const overrides = side === 'buy' ? { value: amount } : {};
      const gas = await method.estimateGas(...args, overrides);
      const gasLimit = gasBudget(gas, 250_000n);
      notify('Estimated execution gas: ' + gas + '. Wallet fee estimates also include current network/data fees.');
      await wallet();
      return settle(await method(...args, { ...overrides, gasLimit }));
    }
  };
}
