import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Interface } from 'ethers';
import {
  BASE_TRADE_PROOF,
  verifyReceiptTrade
} from '../scripts/verify-base-real-wallet-trades.mjs';

const abi = JSON.parse(await readFile('web/generated/base-v2-abi.json','utf8'));
const marketInterface = new Interface(abi.CurveMarketV2);
const tokenInterface = new Interface(abi.LaunchTokenV2);
const HASH = BASE_TRADE_PROOF.buys[0];

function fixture(side='buy', mutate={}) {
  const trader = BASE_TRADE_PROOF.trader;
  const market = BASE_TRADE_PROOF.market;
  const token = BASE_TRADE_PROOF.token;
  const isBuy = side === 'buy';
  const input = isBuy ? 100n : 500n;
  const output = isBuy ? 500n : 100n;
  const trade = marketInterface.encodeEventLog(
    marketInterface.getEvent('Trade'),
    [trader, isBuy, input, output, 2n, 0n, false]
  );
  const transfer = tokenInterface.encodeEventLog(
    tokenInterface.getEvent('Transfer'),
    [
      isBuy ? market : trader,
      isBuy ? trader : market,
      isBuy ? output : input
    ]
  );
  const transaction = {
    chainId: 8453n,
    hash: HASH,
    blockNumber: 51984308,
    from: trader,
    to: market,
    value: isBuy ? input : 0n,
    data: marketInterface.encodeFunctionData(side, isBuy ? [1n, 100000000n] : [input, 1n, 100000000n]),
    ...mutate.transaction
  };
  const receipt = {
    hash: HASH,
    blockNumber: 51984308,
    status: 1,
    logs: [
      { address: token, topics: transfer.topics, data: transfer.data },
      { address: market, topics: trade.topics, data: trade.data }
    ],
    ...mutate.receipt
  };
  return {
    transaction, receipt, side,
    marketAbi: abi.CurveMarketV2,
    tokenAbi: abi.LaunchTokenV2
  };
}

test('real Base BUY proof requires matching trade event and token transfer',()=>{
  const proof = verifyReceiptTrade(fixture());
  assert.equal(proof.side,'buy');
  assert.equal(proof.hash,HASH);
  assert.equal(proof.output,'500');
});

test('real Base SELL proof requires wallet token transfer into official market',()=>{
  const proof = verifyReceiptTrade(fixture('sell'));
  assert.equal(proof.side,'sell');
  assert.equal(proof.input,'500');
});

test('real Base BUY proof rejects ETH amount mismatch and impossible slippage',()=>{
  const wrongValue=fixture('buy',{transaction:{value:101n}});
  assert.throws(()=>verifyReceiptTrade(wrongValue),/Signed buy ETH value/);
  const wrongMinimum=fixture('buy',{transaction:{
    data:marketInterface.encodeFunctionData('buy',[501n,100000000n])
  }});
  assert.throws(()=>verifyReceiptTrade(wrongMinimum),/minimum output exceeds executed/);
});

test('real Base SELL proof rejects wrong token amount and native payment',()=>{
  const wrongInput=fixture('sell',{transaction:{
    data:marketInterface.encodeFunctionData('sell',[501n,1n,100000000n])
  }});
  assert.throws(()=>verifyReceiptTrade(wrongInput),/Signed sell token input/);
  const wrongValue=fixture('sell',{transaction:{value:1n}});
  assert.throws(()=>verifyReceiptTrade(wrongValue),/Sell transaction must not send ETH/);
});

test('wallet receipts reject absent slippage protection and invalid deadlines',()=>{
  for(const side of ['buy','sell']){
    const zeroMinimum=fixture(side,{transaction:{
      data:marketInterface.encodeFunctionData(side,side==='buy'?[0n,100000000n]:[500n,0n,100000000n])
    }});
    assert.throws(()=>verifyReceiptTrade(zeroMinimum),/minimum output must be positive/);
    const zeroDeadline=fixture(side,{transaction:{
      data:marketInterface.encodeFunctionData(side,side==='buy'?[1n,0n]:[500n,1n,0n])
    }});
    assert.throws(()=>verifyReceiptTrade(zeroDeadline),/deadline must be positive/);
  }
});

test('failed receipts, spoofed wallets, wrong chains and unrelated markets fail closed',()=>{
  assert.throws(()=>verifyReceiptTrade(fixture('buy',{receipt:{status:0}})),/did not succeed/);
  assert.throws(()=>verifyReceiptTrade(fixture('buy',{transaction:{chainId:1n}})),/not on Base/);
  assert.throws(()=>verifyReceiptTrade(fixture('buy',{transaction:{from:'0x1111111111111111111111111111111111111111'}})),/not signed/);
  assert.throws(()=>verifyReceiptTrade(fixture('buy',{transaction:{to:'0x1111111111111111111111111111111111111111'}})),/official market/);
});

test('missing transfer, mismatched side and mismatched transaction receipt cannot pass',()=>{
  assert.throws(()=>verifyReceiptTrade(fixture('buy',{receipt:{logs:[fixture().receipt.logs[1]]}})),/token transfer/);
  assert.throws(()=>verifyReceiptTrade({...fixture('buy'),side:'sell'}),/expected trade method/);
  assert.throws(()=>verifyReceiptTrade(fixture('buy',{receipt:{hash:'0x'+'0'.repeat(64)}})),/Receipt does not belong/);
});
