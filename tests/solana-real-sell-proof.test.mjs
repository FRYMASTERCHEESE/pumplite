import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {verifyRecordedSolanaSell, MAYM_SELL_PROOF} from '../scripts/verify-solana-real-sell.mjs';
import {tinyAta,tinyMarketAddress} from '../web/solana-tiny-instructions.js';

const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes) {
  let value=0n;
  for(const byte of bytes) value=(value<<8n)+BigInt(byte);
  let out='';
  while(value>0n){out=alphabet[Number(value%58n)]+out;value/=58n;}
  return out;
}
function u64(value){
  const bytes=Array(8).fill(0);
  for(let i=0;i<8;i++){bytes[i]=Number(value&255n);value>>=8n;}
  return bytes;
}
const mint='EUKhN8eP97NjRHzxwRT5pdgLg7BX5KRTBhJYa2hMu9ma';
const mintKey=new PublicKey(mint), traderKey=new PublicKey(MAYM_SELL_PROOF.signer);
const market=tinyMarketAddress(mintKey,new PublicKey(MAYM_SELL_PROOF.programId)).toBase58();
const ata=tinyAta(mintKey,traderKey).toBase58();

function fixture(){
  const sold=MAYM_SELL_PROOF.tokenRaw;
  return {
    slot:MAYM_SELL_PROOF.slot,
    blockTime:1791628067,
    transaction:{
      signatures:[MAYM_SELL_PROOF.signature],
      message:{
        accountKeys:[
          {pubkey:MAYM_SELL_PROOF.signer,signer:true},
          {pubkey:market,signer:false},
          {pubkey:mint,signer:false},
          {pubkey:ata,signer:false}
        ],
        instructions:[{
          programId:MAYM_SELL_PROOF.programId,
          accounts:[MAYM_SELL_PROOF.signer,market,mint,ata,MAYM_SELL_PROOF.signer],
          data:b58([1,...u64(sold),...u64(1n)])
        }]
      }
    },
    meta:{
      err:null,
      preBalances:[1000000,1000000000,0,0],
      postBalances:[1000000,999699984,0,0],
      preTokenBalances:[{accountIndex:3,mint,uiTokenAmount:{amount:sold.toString()}}],
      postTokenBalances:[{accountIndex:3,mint,uiTokenAmount:{amount:'0'}}],
      innerInstructions:[{index:0,instructions:[
        {program:'spl-token',parsed:{type:'burn',info:{mint,amount:sold.toString()}}},
        {program:'system',parsed:{type:'transfer',info:{
          source:market,destination:MAYM_SELL_PROOF.signer,lamports:Number(MAYM_SELL_PROOF.walletPayoutLamports)
        }}}
      ]}]
    }
  };
}
test('recorded finalized Solana sell requires genuine program, PDA, burn and native payout evidence',()=>{
  const proof=verifyRecordedSolanaSell(fixture());
  assert.equal(proof.signature,MAYM_SELL_PROOF.signature);
  assert.equal(proof.burnedRaw,'10000000000');
  assert.equal(proof.payoutLamports,'299266');
});
test('real sell proof rejects missing or failed signature',()=>{
  const bad=fixture(); bad.transaction.message.accountKeys[0].signer=false;
  assert.throws(()=>verifyRecordedSolanaSell(bad),/wallet signature/);
  const failed=fixture(); failed.meta.err={Custom:1};
  assert.throws(()=>verifyRecordedSolanaSell(failed),/failed or is missing/);
});
test('real sell proof rejects wrong program, signer and PDA substitution',()=>{
  const program=fixture();program.transaction.message.instructions[0].programId='11111111111111111111111111111111';
  assert.throws(()=>verifyRecordedSolanaSell(program),/one PumpLite trade/);
  const marketAlias=fixture();marketAlias.transaction.message.instructions[0].accounts[1]=MAYM_SELL_PROOF.signer;
  assert.throws(()=>verifyRecordedSolanaSell(marketAlias),/official PumpLite PDA/);
});
test('real sell proof rejects missing token burn or SOL transfer',()=>{
  const noBurn=fixture();noBurn.meta.innerInstructions[0].instructions.shift();
  assert.throws(()=>verifyRecordedSolanaSell(noBurn),/token burn/);
  const noPayment=fixture();noPayment.meta.innerInstructions[0].instructions.pop();
  assert.throws(()=>verifyRecordedSolanaSell(noPayment),/payout System Program transfer/);
});
test('real sell proof rejects mismatch to photographed amount or official slot',()=>{
  const otherAmount=fixture();otherAmount.meta.postBalances[1]++;
  assert.throws(()=>verifyRecordedSolanaSell(otherAmount),/computed SOL proceeds differ/);
  const otherSlot=fixture();otherSlot.slot++;
  assert.throws(()=>verifyRecordedSolanaSell(otherSlot),/Solana slot differs/);
});
