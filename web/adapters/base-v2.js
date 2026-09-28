import { discoverEvm, watchWallet } from '../wallets.js';
import { BrowserProvider, JsonRpcProvider, Contract, getAddress, FetchRequest } from 'ethers';
import { gasBudget } from '../gas.js';
import { boundedFetch } from '../rpc-fetch.js';
import abis from '../generated/base-v2-abi.json' with { type: 'json' };
import { assertReceipt } from '../math.js';

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
  const request = new FetchRequest(config.rpcUrl);
  request.timeout = 15000; request.setThrottleParams({ maxAttempts: 1 });
  request.getUrlFunc = async (req, signal) => {
    const controller = new AbortController();
    signal?.addListener(() => controller.abort()); if (signal?.cancelled) controller.abort();
    const response = await boundedFetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: controller.signal });
    return { statusCode: response.status, statusMessage: response.statusText, headers: { 'content-type': 'application/json' }, body: new Uint8Array(await response.arrayBuffer()) };
  };
  const provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
  let walletProvider, signer, connectedAddress, selected, revision = 0, unwatch = () => {};
  function disconnect() {
    revision++; unwatch(); unwatch = () => {}; walletProvider?.destroy();
    walletProvider = undefined; signer = undefined; connectedAddress = undefined; selected = undefined; changed();
  }
  const factory = () => {
    if (!config.factory) throw Error('Base contracts have not been deployed');
    return new Contract(config.factory, abis.LaunchFactoryV2, provider);
  };
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
  return {
    disconnect,
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
      if (typeof message !== 'string' || new TextEncoder().encode(message).length > 2048) throw Error('Metadata authorization message is invalid');

      const active = await wallet();
      const attempt = revision;

      notify('Review the metadata authorization message. This signature does not spend ETH.');

      const signature = await active.signMessage(message);

      if (attempt !== revision || !signer) throw Error('Wallet changed while signing; reconnect');

      if (typeof signature !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) || signature.length > 1026) {
        throw Error('Wallet returned an invalid Base signature');
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

      const f = factory().connect(await wallet());

      const launchConfig = {
        name,
        symbol,
        uri,
        initialSupply,
        maxSupply,
        mintable: mintable === true,
        initialMayhem: initialMayhem === true
      };

      const gas = await f.createMarketV2.estimateGas(launchConfig);
      const gasLimit = gasBudget(gas, 5_000_000n);

      notify('Estimated V2 creation gas: ' + gas + '. Review the wallet fee before approving.');

      await wallet();

      const receipt = await settle(
        await f.createMarketV2(launchConfig, { gasLimit })
      );

      for (const log of receipt.logs) {
        if (getAddress(log.address) !== getAddress(config.factory)) continue;

        try {
          const parsed = f.interface.parseLog(log);
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
      const curve = new Contract(verified.id, abis.CurveMarketV2, s);

      const gas = await curve.setMayhem.estimateGas(enabled);
      const gasLimit = gasBudget(gas, 150_000n);

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
