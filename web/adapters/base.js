import { BrowserProvider, JsonRpcProvider, Contract, getAddress } from 'ethers';
import abis from '../generated/base-abi.json' with { type: 'json' };
import { BASE_SUPPLY, assertReceipt } from '../math.js';

export function adapter(config, notify) {
  if (config.chainId !== 8453) throw Error('Unsupported Base chain configuration');
  const provider = new JsonRpcProvider(config.rpcUrl, undefined, { batchMaxCount: 1 });
  let walletProvider, signer, connectedAddress;
  const factory = () => {
    if (!config.factory) throw Error('Base contracts have not been deployed');
    return new Contract(config.factory, abis.LaunchFactory, provider);
  };
  async function network() {
    const id = BigInt(await provider.send('eth_chainId', []));
    if (id !== 8453n) throw Error('RPC is not Base Mainnet');
  }
  async function wallet() {
    if (!signer) throw Error('Connect your wallet first');
    if (BigInt(await window.ethereum.request({ method: 'eth_chainId' })) !== 8453n) throw Error('Wallet must be on Base Mainnet');
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accounts[0] || getAddress(accounts[0]) !== connectedAddress) throw Error('Wallet changed; reconnect');
    await network();
    return signer;
  }
  async function settle(tx) {
    notify('Submitted. Waiting for a Base receipt.', config.explorer + '/tx/' + tx.hash);
    // A replacement is not silently treated as success for this operation.
    const receipt = await tx.wait(2);
    assertReceipt(receipt);
    notify('Confirmed on Base (2 confirmations).', config.explorer + '/tx/' + receipt.hash);
    return receipt;
  }
  async function market(id) {
    await network();
    const blockTag = await provider.getBlockNumber();
    if (!await factory().isMarket(id, { blockTag })) throw Error('Market is not in the configured factory');
    const curve = new Contract(id, abis.CurveMarket, provider);
    const [tokenAddress, nativeReserve, tokenReserve, volume, creator, treasury] = await Promise.all([
      curve.token({ blockTag }), curve.nativeReserve({ blockTag }), curve.tokenReserve({ blockTag }),
      curve.volume({ blockTag }), curve.creator({ blockTag }), curve.TREASURY({ blockTag })
    ]);
    if (getAddress(treasury) !== getAddress(config.treasury)) throw Error('Unexpected platform treasury');
    const token = new Contract(tokenAddress, abis.LaunchToken, provider);
    const [name, symbol] = await Promise.all([token.name({ blockTag }), token.symbol({ blockTag })]);
    return { id: getAddress(id), token: tokenAddress, creator, name, symbol, nativeReserve, tokenReserve, volume,
      decimals: 18, nativeDecimals: 18, unit: 'ETH', virtualNative: 10n ** 18n, supply: BASE_SUPPLY,
      source: 'Base block ' + blockTag, observedAt: Date.now() };
  }
  return {
    async connect() {
      if (!window.ethereum) throw Error('Install an EVM wallet');
      walletProvider?.destroy();
      signer = undefined; connectedAddress = undefined;
      try {
        await network();
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (BigInt(await window.ethereum.request({ method: 'eth_chainId' })) !== 8453n) {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
        }
        walletProvider = new BrowserProvider(window.ethereum);
        signer = await walletProvider.getSigner();
        connectedAddress = await signer.getAddress();
        await wallet();
        return connectedAddress;
      } catch (error) {
        walletProvider?.destroy(); walletProvider = undefined;
        signer = undefined; connectedAddress = undefined;
        throw error;
      }
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
      const token = new Contract(m.token, abis.LaunchToken, provider);
      const [native, tokens] = await Promise.all([provider.getBalance(connectedAddress), token.balanceOf(connectedAddress)]);
      return { native, tokens };
    },
    async create({ name, symbol, uri }) {
      const f = factory().connect(await wallet());
      const receipt = await settle(await f.createMarket(name, symbol, uri));
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== getAddress(config.factory)) continue;
        try { const parsed = f.interface.parseLog(log); if (parsed?.name === 'MarketCreated') return parsed.args.market; } catch {}
      }
      throw Error('Confirmed transaction has no expected factory event; inspect receipt');
    },
    async trade(m, side, amount, min) {
      if (!['buy', 'sell'].includes(side) || amount <= 0n || min <= 0n) throw Error('Invalid trade parameters');
      const s = await wallet();
      // Validate registry again immediately before interacting.
      const verified = await market(m.id);
      if (getAddress(verified.token) !== getAddress(m.token)) throw Error('Market token changed; reload');
      const curve = new Contract(verified.id, abis.CurveMarket, s);
      if (side === 'sell') {
        const token = new Contract(verified.token, abis.LaunchToken, s);
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
      return settle(side === 'buy' ? await curve.buy(min, deadline, { value: amount }) : await curve.sell(amount, min, deadline));
    }
  };
}
