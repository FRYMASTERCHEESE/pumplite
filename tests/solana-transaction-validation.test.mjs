import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,Transaction,TransactionInstruction,ComputeBudgetProgram} from '@solana/web3.js';
import {buildTinyFirstBuyerActivationInstructions} from '../web/solana-tiny-instructions.js';
import {snapshotTransaction,validateWalletTransaction,publicInstructionSequence} from '../web/solana-transaction-validation.js';
const payer=new PublicKey('BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct');
const built=buildTinyFirstBuyerActivationInstructions({buyer:payer,creator:payer,treasury:payer,programId:new PublicKey('3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'),name:'Synthetic',symbol:'TEST',uri:'https://example.invalid/test',mintRentLamports:1500000,buyAmount:2000000n,buyMinimum:1n});
const wire=ix=>Transaction.from(new Transaction({feePayer:payer,recentBlockhash:'11111111111111111111111111111111'}).add(...ix).serialize({requireAllSignatures:false,verifySignatures:false}));
const original=wire(built.instructions), snapshot=snapshotTransaction(original);
const prefix=[ComputeBudgetProgram.setComputeUnitLimit({units:200000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:375000})];
const check=ix=>validateWalletTransaction(snapshot,wire(ix));
const custom=(v,n)=>{const data=Buffer.alloc(5);data[0]=v;data.writeUInt32LE(n,1);return new TransactionInstruction({programId:ComputeBudgetProgram.programId,keys:[],data});};
test('two Compute Budget prefix plus actual original six passes',()=>{assert.equal(original.instructions.length,6);check([...prefix,...original.instructions]);});
test('unchanged original six passes',()=>check(original.instructions));
test('all four bounded variants and suffix pass',()=>check([custom(1,32768),...prefix,...original.instructions,custom(4,67108864)]));
test('duplicated business sequence rejects, including observed 14-instruction shape',()=>assert.throws(()=>check([...prefix,...original.instructions,...original.instructions]),/duplicated/));
test('injected Memo/System/Token and partial duplicate reject',()=>{
 for(const id of ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr','11111111111111111111111111111111','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'])assert.throws(()=>check([...original.instructions,new TransactionInstruction({programId:new PublicKey(id),keys:[],data:Buffer.alloc(0)})]),/non-Compute/);
 assert.throws(()=>check([...original.instructions,original.instructions[0]]),/non-Compute/);
});
test('changed business data, account flags or pubkey reject',()=>{
 for(const change of [t=>t.instructions[0].data[0]^=1,t=>t.instructions[0].keys[0].isSigner=false,t=>t.instructions[0].keys[0].isWritable=false,t=>t.instructions[0].keys[0].pubkey=ComputeBudgetProgram.programId]){const t=wire(original.instructions);change(t);assert.throws(()=>validateWalletTransaction(snapshot,t),/changed/);}
});
test('duplicate, unsafe, malformed or keyed Compute Budget rejects',()=>{
 for(const ix of [custom(1,32769),custom(1,263168),custom(2,1400001),custom(4,0),custom(4,67108865),custom(0,1)])assert.throws(()=>check([ix,...original.instructions]));
 assert.throws(()=>check([...prefix,prefix[0],...original.instructions]),/Duplicate/);
 const keyed=custom(1,32768);keyed.keys=[{pubkey:payer,isSigner:false,isWritable:false}];assert.throws(()=>check([keyed,...original.instructions]));
 const malformed=custom(1,32768);malformed.data=Buffer.alloc(6);assert.throws(()=>check([malformed,...original.instructions]));
});
test('immutable snapshot rejects in-place blockhash/payer mutation',()=>{
 const tx=wire(original.instructions),snap=snapshotTransaction(tx);tx.recentBlockhash=payer.toBase58();assert.throws(()=>validateWalletTransaction(snap,tx),/blockhash/);
 tx.recentBlockhash=snap.blockhash;tx.feePayer=ComputeBudgetProgram.programId;assert.throws(()=>validateWalletTransaction(snap,tx),/fee payer/);
});
test('public diagnostics contain all indices, no signatures or raw transactions',()=>{
 const rows=publicInstructionSequence(wire([...prefix,...original.instructions,...original.instructions]));assert.equal(rows.length,14);assert.deepEqual(rows.map(x=>x.index),Array.from({length:14},(_,i)=>i));assert.doesNotMatch(JSON.stringify(rows),/signature|secret|serialized/i);
});

// Synthetic encodings from pinned Lighthouse Borsh/LEB128 schemas, NOT captured wallet data.
const lighthouse=new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');
const integer=(field,value=0)=>{const d=Buffer.alloc(10);d[0]=field;d.writeBigUInt64LE(BigInt(value),1);return d;};
const info13=Buffer.concat([Buffer.from([6,0,1]),integer(0)]);
const info26=Buffer.concat([Buffer.from([6,0,3]),integer(0),integer(1),Buffer.from([3,0,0])]);
const token27=Buffer.concat([Buffer.from([10,0,4]),integer(2),integer(6),Buffer.from([4,1,0,8])]);
const lh=(key,data=info13)=>new TransactionInstruction({programId:lighthouse,keys:[{...key}],data:Buffer.from(data)});
const targets=[...new Map(original.instructions.flatMap(i=>i.keys).map(k=>[k.pubkey.toBase58(),k])).values()];
const liveShape=()=>[...prefix,...targets.slice(0,4).map(k=>lh(k)),...original.instructions,lh(targets[0],info26),lh(targets[1],token27)];
test('Lighthouse 4-prefix + original six + 2-suffix with budgets passes',()=>{
 assert.deepEqual([info13.length,info26.length,token27.length],[13,26,27]);const tx=wire(liveShape());assert.equal(tx.instructions.length,14);validateWalletTransaction(snapshot,tx);
});
test('Lighthouse unrelated account rejects',()=>assert.throws(()=>check([lh({pubkey:new PublicKey(new Uint8Array(32).fill(99)),isSigner:false,isWritable:false}),...original.instructions]),/Unrelated/));
test('Lighthouse unknown discriminator and malformed lengths reject',()=>{
 for(const data of [Buffer.from([0,0,1,...info13.subarray(3)]),info13.subarray(0,12),Buffer.concat([info13,Buffer.from([0])]),Buffer.from([6,0,129,0,...info13.subarray(3)])])assert.throws(()=>check([lh(targets[0],data),...original.instructions]),/Lighthouse/);
});
test('Lighthouse excessive signer or writable privilege rejects',()=>{
 for(const flag of ['isSigner','isWritable']){
 const key=targets.find(k=>!snapshot.accounts[k.pubkey.toBase58()][flag]);assert.ok(key);
 const t=wire(original.instructions);t.instructions.unshift(lh({...key,[flag]:true}));assert.throws(()=>validateWalletTransaction(snapshot,t),/privileges/);
 }
});
test('Lighthouse wrong account counts, repeated instructions and seventh assertion reject',()=>{
 for(const n of [0,2]){const ix=lh(targets[0]);ix.keys=Array.from({length:n},()=>({...targets[0]}));assert.throws(()=>check([ix,...original.instructions]),/exactly one/);}
 assert.throws(()=>check([lh(targets[0]),lh(targets[0]),...original.instructions]),/Duplicate Lighthouse/);
 const ix=liveShape();ix.push(lh(targets[2],info26));assert.throws(()=>check(ix),/Too many Lighthouse/);
});
test('Lighthouse invalid log level, enum, bool, operator, option and duplicate field encoding reject',()=>{
 for(const data of [Buffer.from([6,7,1,...integer(0)]),Buffer.from([6,0,1,9]),Buffer.from([6,0,1,5,2,0]),Buffer.from([6,0,1,3,9,0]),Buffer.from([10,0,1,3,2,0]),Buffer.from([6,0,2,...integer(0),...integer(0)])])assert.throws(()=>check([lh(targets[0],data),...original.instructions]),/Lighthouse/);
 const bad=Buffer.from(info13);bad[12]=8;assert.throws(()=>check([lh(targets[0],bad),...original.instructions]),/Lighthouse/);
});
