import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTinyTradeTransaction } from '../web/solana-tiny-history.js';

const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes){
  let n=0n;for(const b of bytes)n=(n<<8n)+BigInt(b);
  let out='';while(n>0n){out=alphabet[Number(n%58n)]+out;n/=58n;}
  let z=0;while(z<bytes.length&&bytes[z]===0)z++;
  return '1'.repeat(z)+out;
}
function u64(value){const b=new Uint8Array(8);let n=BigInt(value);for(let i=0;i<8;i++){b[i]=Number(n&255n);n>>=8n;}return b;}
function data(tag,input,min=1n){return b58(Uint8Array.from([tag,...u64(input),...u64(min)]));}
const ids={programId:'Prog1111111111111111111111111111111111111',mint:'Mint1111111111111111111111111111111111111',market:'Mark1111111111111111111111111111111111111',treasury:'Tres1111111111111111111111111111111111111'};
const keys=['Trader11111111111111111111111111111111111',ids.market,ids.mint,'Ata11111111111111111111111111111111111111',ids.treasury];

function tx(tag,input,preToken,postToken,preMarket,postMarket){
 return {
  slot:123,blockTime:1700000000,
  transaction:{signatures:['Sig11111111111111111111111111111111111111111111111111111111111111111111111111111111111'],message:{accountKeys:keys,instructions:[{programId:ids.programId,accounts:keys,data:data(tag,input)}]}},
  meta:{err:null,preBalances:[0,preMarket,0,0,0],postBalances:[0,postMarket,0,0,0],preTokenBalances:[{accountIndex:3,mint:ids.mint,uiTokenAmount:{amount:String(preToken)}}],postTokenBalances:[{accountIndex:3,mint:ids.mint,uiTokenAmount:{amount:String(postToken)}}]}
 };
}

test('parses PumpLite buy from exact instruction input and token delta',()=>{
 const trade=parseTinyTradeTransaction(tx(0,1000000n,0n,33248894474n,0,997500),ids);
 assert.equal(trade.isBuy,true);
 assert.equal(trade.input,1000000n);
 assert.equal(trade.output,33248894474n);
 assert.equal(trade.nativeGross,1000000n);
 assert.equal(trade.fee,2500n);
});

test('parses PumpLite sell from burn delta and market SOL decrease',()=>{
 const trade=parseTinyTradeTransaction(tx(1,1000000n,2000000n,1000000n,2000000,1900000),ids);
 assert.equal(trade.isBuy,false);
 assert.equal(trade.input,1000000n);
 assert.equal(trade.nativeGross,100000n);
 assert.equal(trade.output,99750n);
 assert.equal(trade.fee,250n);
});

test('rejects a foreign or malformed instruction',()=>{
 const value=tx(0,1000000n,0n,100n,0,997500);
 value.transaction.message.instructions[0].programId='Other111111111111111111111111111111111111';
 assert.equal(parseTinyTradeTransaction(value,ids),null);
});
