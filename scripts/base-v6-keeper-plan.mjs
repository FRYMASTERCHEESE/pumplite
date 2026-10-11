// Read-only keeper planner. Never signs, stores keys, submits, or funds a market.
import { Interface, getAddress, ZeroHash } from 'ethers';

export async function planBaseV6Keeper({ provider, factory, market, controller,
  secret, secretDurablyStored = false, maxGasPriceWei, remainingFeeBudgetWei }) {
  const signer = getAddress(controller);
  const priceCap = BigInt(maxGasPriceWei), budget = BigInt(remainingFeeBudgetWei);
  if (priceCap <= 0n || budget <= 0n) throw Error('Positive fee limits required');
  if (BigInt(await provider.send('eth_chainId', [])) !== 8453n) throw Error('Wrong keeper chain');
  const block = await provider.send('eth_getBlockByNumber', ['latest', false]);
  const tag = { blockTag: Number(BigInt(block.number)) };
  const height = BigInt(block.number), now = BigInt(block.timestamp);
  const address = getAddress(await market.getAddress());
  const [fv, mv, registered, fc, mc, mode, state, finalized, commitment, committedAt,
    pendingManual, lastTrade, limits] = await Promise.all([
    factory.protocolVersion(tag), market.protocolVersion(tag), factory.isMarket(address, tag),
    factory.mayhemController(tag), market.mayhemController(tag), market.launchMode(tag),
    market.mayhemState(tag), market.mayhemFinalized(tag), market.mayhemCommitment(tag),
    market.mayhemCommitBlock(tag), market.pendingManualRequest(tag), market.lastAgentTradeAt(tag),
    market.limits(tag)
  ]);
  if (fv !== 6n || mv !== 6n || !registered || getAddress(fc) !== signer || getAddress(mc) !== signer)
    throw Error('Unverified V6 market/controller');
  const idle = reason => ({ action: 'wait', reason, block: tag.blockTag, to: address, value: 0n });
  let method, args = [];
  if (mode === 0n || finalized) return idle('Classic or finalized');
  if (state === 3n) method = 'finalizeMayhem';
  else if (commitment !== ZeroHash) {
    if (height > committedAt + 255n) method = 'expireMayhemCommitment';
    else {
      if (height <= committedAt + 1n) return idle('Future hash not available yet');
      if (!secret || secretDurablyStored !== true) return idle('Recover durable secret or wait for expiry');
      if (await market.mayhemCommitmentHash(secret, tag) !== commitment) throw Error('Journal secret mismatch');
      if (state !== 1n) return idle('Paused; retain commitment for recovery');
      // Do not pick a new secret after seeing the future hash. An unexecutable
      // committed direction consumes its attempt on expiry, instead of retrying.
      try { await market.previewMayhemReveal(secret, tag); }
      catch (error) {
        if (['Liquidity', 'MayhemLimit'].includes(error.revert?.name)) return idle('Committed trade cannot execute; wait for expiry');
        throw error;
      }
      method = 'revealMayhemTrade'; args = [secret];
    }
  } else {
    if (state !== 1n) return idle('Paused; keeper never adds funding');
    if (mode === 2n && !pendingManual) return idle('Creator Manual request required');
    if (lastTrade !== 0n && now < lastTrade + limits.minInterval) return idle('Minimum interval');
    if (!secret || secretDurablyStored !== true) return idle('Persist one secret before committing');
    method = 'commitMayhemTrade'; args = [await market.mayhemCommitmentHash(secret, tag)];
  }
  const data = new Interface(market.interface.fragments).encodeFunctionData(method, args);
  const gasPrice = BigInt(await provider.send('eth_gasPrice', []));
  if (gasPrice > priceCap) return idle('Gas price ceiling');
  const gas = await provider.estimateGas({ from: signer, to: address, data, value: 0n });
  // Conservative local budget includes 20% execution headroom and L1 fees.
  // The eventual approved signer must recheck this immediately before signing.
  const gasLimit = (gas * 120n + 99n) / 100n;
  const l1Oracle = new Interface(['function getL1FeeUpperBound(uint256) view returns (uint256)']);
  const feeData = await provider.call({to:'0x420000000000000000000000000000000000000F',
    data:l1Oracle.encodeFunctionData('getL1FeeUpperBound', [(data.length - 2) / 2 + 512])});
  const l1FeeUpperBound = l1Oracle.decodeFunctionResult('getL1FeeUpperBound', feeData)[0];
  const maximumEstimatedFee = gasLimit * gasPrice + l1FeeUpperBound;
  if (maximumEstimatedFee > budget) return idle('Remaining fee budget');
  return { action: method, args, to: address, data, value: 0n, from: signer,
    block: tag.blockTag, gasLimit, maxFeePerGas: gasPrice, l1FeeUpperBound, maximumEstimatedFee };
}
