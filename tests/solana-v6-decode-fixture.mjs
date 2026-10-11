import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { decodeV6Market, V6_MARKET_BYTES } from '../web/solana-v6-market.js';
const [program,id,hex,supply,mode] = process.argv.slice(2);
const account={owner:new PublicKey(program),data:Buffer.from(hex,'hex')};
const args={id,account,programId:new PublicKey(program),mintSupply:BigInt(supply),slot:1,timestamp:1000000};
const market=await decodeV6Market(args);
assert.equal(account.data.length,V6_MARKET_BYTES);
assert.equal(market.launchMode,Number(mode)); assert.equal(market.contractVersion,6);
for(const change of [
  {account:{...account,owner:new PublicKey(new Uint8Array(32).fill(1))}},
  {account:{...account,data:account.data.subarray(0,368)}},
  {mintSupply:0n}, {timestamp:null}, {id:new PublicKey(new Uint8Array(32).fill(2)).toBase58()}
]) await assert.rejects(decodeV6Market({...args,...change}));
for(const [offset,value] of [[8,1],[122,3],[239,2]]) {
  const data=Buffer.from(account.data); data[offset]=value;
  await assert.rejects(decodeV6Market({...args,account:{...account,data}}));
}
console.log([market.contractVersion,market.launchMode,market.nativeReserve,market.tokenReserve,market.agentInventory,market.agentNativeBank].join('|'));
