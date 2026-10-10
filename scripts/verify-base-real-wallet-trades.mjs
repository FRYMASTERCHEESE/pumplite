// Read-only Mainnet proof. No wallet connection, signing or transaction sending.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  Interface,
  JsonRpcProvider,
  getAddress
} from 'ethers';

export const BASE_TRADE_PROOF = Object.freeze({
  chainId: 8453n,
  trader: '0x0de7FdCc798F7FAC6b03b366c529133A9c60794d',
  market: '0xa522A4Ef81fD31daec390ab46A32D4886e1461C7',
  token: '0xb15A460142c77b42cDF57815b0eeFEb24b593196',
  buys: [
    '0xaa21b4bb7b150d36d741be90239e80ae6fd4733670733f7b8c7d53aa1b5dcfc6',
    '0x2dff1656acd33afbbc78ae8505e7f3c071a59030a0190fde6a326d0d981bc5aa'
  ]
});

export function verifyReceiptTrade({
  transaction,
  receipt,
  side,
  market = BASE_TRADE_PROOF.market,
  token = BASE_TRADE_PROOF.token,
  trader = BASE_TRADE_PROOF.trader,
  marketAbi,
  tokenAbi
}) {
  assert.ok(['buy', 'sell'].includes(side), 'Expected buy or sell proof');
  assert.ok(transaction && receipt, 'Trade transaction or receipt is missing');
  assert.equal(receipt.status, 1, 'Live trade did not succeed');
  assert.equal(
    getAddress(transaction.from), getAddress(trader),
    'Trade was not signed by the expected wallet'
  );
  assert.equal(
    getAddress(transaction.to), getAddress(market),
    'Trade was not sent to the official market'
  );
  assert.equal(
    Number(transaction.chainId), 8453,
    'Trade was not on Base Mainnet'
  );
  assert.equal(
    String(transaction.hash).toLowerCase(),
    String(receipt.hash).toLowerCase(),
    'Receipt does not belong to the transaction'
  );
  assert.equal(receipt.blockNumber, transaction.blockNumber, 'Receipt block differs from transaction block');

  const marketInterface = new Interface(marketAbi);
  const tokenInterface = new Interface(tokenAbi);
  const call = marketInterface.parseTransaction({
    data: transaction.data,
    value: transaction.value
  });
  assert.equal(call?.name, side, 'Transaction did not call the expected trade method');

  const minimumOutput = side === 'buy' ? call.args[0] : call.args[1];
  const deadline = side === 'buy' ? call.args[1] : call.args[2];
  assert.ok(minimumOutput > 0n, 'Trade minimum output must be positive');
  assert.ok(deadline > 0n, 'Trade deadline must be positive');

  const topic = marketInterface.getEvent('Trade').topicHash;
  const transferTopic = tokenInterface.getEvent('Transfer').topicHash;
  const matches = receipt.logs.filter(log =>
    getAddress(log.address) === getAddress(market) &&
    String(log.topics?.[0]).toLowerCase() === topic.toLowerCase()
  );
  assert.equal(matches.length, 1, 'Receipt does not have exactly one official market Trade event');

  const trade = marketInterface.parseLog(matches[0]);
  assert.equal(getAddress(trade.args.trader), getAddress(trader), 'Trade event wallet mismatch');
  assert.equal(trade.args.isBuy, side === 'buy', 'Trade event side mismatch');
  assert.ok(trade.args.input > 0n && trade.args.output > 0n, 'Trade executed without positive amounts');
  assert.ok(minimumOutput <= trade.args.output, 'Signed minimum output exceeds executed amount');
  if (side === 'buy') {
    assert.equal(transaction.value, trade.args.input, 'Signed buy ETH value differs from executed input');
  } else {
    assert.equal(transaction.value, 0n, 'Sell transaction must not send ETH');
    assert.equal(call.args[0], trade.args.input, 'Signed sell token input differs from executed input');
  }

  const matchingTransfers = receipt.logs.filter(log => {
    if (getAddress(log.address) !== getAddress(token) ||
        String(log.topics?.[0]).toLowerCase() !== transferTopic.toLowerCase()) return false;
    const transfer = tokenInterface.parseLog(log);
    const from = side === 'buy' ? market : trader;
    const to = side === 'buy' ? trader : market;
    return getAddress(transfer.args.from) === getAddress(from) &&
      getAddress(transfer.args.to) === getAddress(to) &&
      transfer.args.value === (side === 'buy' ? trade.args.output : trade.args.input);
  });
  assert.equal(matchingTransfers.length, 1, 'Official token transfer did not match the Trade event');
  return {
    side,
    hash: receipt.hash,
    block: receipt.blockNumber,
    wallet: getAddress(trader),
    token: getAddress(token),
    input: trade.args.input.toString(),
    output: trade.args.output.toString()
  };
}

export async function verifyLiveReceipt({
  provider, hash, side, marketAbi, tokenAbi
}) {
  assert.match(hash, /^0x[0-9a-fA-F]{64}$/, 'Expected a public transaction hash');
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(hash),
    provider.getTransactionReceipt(hash)
  ]);
  return verifyReceiptTrade({
    transaction, receipt, side, marketAbi, tokenAbi
  });
}

async function main() {
  const config = JSON.parse(await readFile('config.json', 'utf8'));
  const abis = JSON.parse(
    await readFile('web/generated/base-v2-abi.json', 'utf8')
  );
  assert.equal(config.base.chainId, 8453);
  assert.equal(getAddress(config.base.factory), getAddress('0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4'));

  const rpcUrls = [config.base.rpcUrl, ...(config.base.rpcFallbackUrls || [])];
  let lastError;
  for (const rpc of rpcUrls) {
    const provider = new JsonRpcProvider(rpc, 8453, { staticNetwork: true, batchMaxCount: 1 });
    try {
      const chain = await provider.getNetwork();
      assert.equal(chain.chainId, 8453n);
      const results = [];
      for (const hash of BASE_TRADE_PROOF.buys) {
        results.push(await verifyLiveReceipt({
          provider, hash, side: 'buy',
          marketAbi: abis.CurveMarketV2,
          tokenAbi: abis.LaunchTokenV2
        }));
      }
      for (const proof of results) {
        console.log('PASS - real-wallet Base BUY receipt:', proof.hash, 'block:', proof.block);
      }
      const sell = String(process.env.PUMPLITE_BASE_SELL_TX_HASH || '').trim();
      if (sell) {
        const proof = await verifyLiveReceipt({
          provider, hash: sell, side: 'sell',
          marketAbi: abis.CurveMarketV2,
          tokenAbi: abis.LaunchTokenV2
        });
        console.log('PASS - real-wallet Base SELL receipt:', proof.hash, 'block:', proof.block);
        console.log('PASS - Base real-wallet BUY and SELL are proven on-chain');
      } else {
        console.log('NOT VERIFIED - no actual SELL transaction hash supplied. Buy evidence does not prove selling.');
      }
      console.log('No transaction sent, no private key requested, no funds spent.');
      return;
    } catch (error) {
      lastError = error;
      console.warn('Read-only trade proof provider unavailable or evidence invalid:', error?.shortMessage || error?.message || String(error));
    } finally {
      provider.destroy();
    }
  }
  throw lastError || Error('No Base Mainnet receipt source available');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
