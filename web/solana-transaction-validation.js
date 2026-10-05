import { LIGHTHOUSE, validateLighthouseData } from './solana-lighthouse.js';
import { Buffer } from 'buffer';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
function fingerprint(ix) {
  return JSON.stringify([ix.programId.toBase58(), Buffer.from(ix.data).toString('hex'), ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable])]);
}
// Called on the canonical wire-decoded transaction BEFORE handing anything to Phantom.
export function snapshotTransaction(tx) {
  const accounts={};
  for(const ix of tx.instructions) for(const k of ix.keys) {
    const key=k.pubkey.toBase58(), old=accounts[key];
    accounts[key]=Object.freeze({isSigner:!!(old?.isSigner||k.isSigner),isWritable:!!(old?.isWritable||k.isWritable)});
  }
  accounts[tx.feePayer.toBase58()]=Object.freeze({isSigner:true,isWritable:true});
  return Object.freeze({accounts:Object.freeze(accounts),payer:tx.feePayer.toBase58(), blockhash:tx.recentBlockhash,
    instructions:Object.freeze(tx.instructions.map(fingerprint))});
}
export function publicInstructionSequence(tx) {
  return tx.instructions.map((ix,index) => ({index, programId:ix.programId.toBase58(),
    discriminator:ix.data.length ? ix.data[0] : null, dataLength:ix.data.length,
    keyCount:ix.keys.length, keys:ix.keys.map(k => ({pubkey:k.pubkey.toBase58(),isSigner:k.isSigner,isWritable:k.isWritable}))}));
}
export function validateWalletTransaction(snapshot, signed) {
  if (signed.feePayer?.toBase58() !== snapshot.payer) throw Error('Wallet changed the fee payer');
  if (signed.recentBlockhash !== snapshot.blockhash) throw Error('Wallet changed the blockhash');
  const expected = snapshot.instructions, actual = signed.instructions.map(fingerprint), matches=[];
  if (!expected.length) throw Error('Empty original transaction');
  for (let start=0; start<=actual.length-expected.length; start++) {
    if (expected.every((value,i) => actual[start+i]===value)) matches.push(start);
  }
  if (!matches.length) throw Error('Wallet changed or split PumpLite business instructions');
  if (matches.length!==1) throw Error('Wallet duplicated PumpLite business instructions');
  const start=matches[0], outside=signed.instructions.filter((_,i) => i<start || i>=start+expected.length);
  if (outside.length>10) throw Error('Wallet added unexpected instructions');
  const seen=new Set(), lighthouseSeen=new Set(); let lighthouseCount=0;
  for (const ix of outside) {
    if(ix.programId.toBase58()===LIGHTHOUSE) {
      if(++lighthouseCount>6)throw Error('Too many Lighthouse assertions'); // Observed four pre + two post.
      if(ix.keys.length!==1)throw Error('Lighthouse requires exactly one target account');
      const k=ix.keys[0], allowed=snapshot.accounts[k.pubkey.toBase58()];
      if(!allowed)throw Error('Unrelated Lighthouse target');
      if((k.isSigner&&!allowed.isSigner)||(k.isWritable&&!allowed.isWritable))throw Error('Excessive Lighthouse privileges');
      validateLighthouseData(ix.data);
      // Identical pre/post assertions are useful; repeated copies on the same side are not.
      const side=signed.instructions.indexOf(ix)<start?'pre':'post';
      const id=side+fingerprint(ix);
      if(lighthouseSeen.has(id))throw Error('Duplicate Lighthouse instruction');
      lighthouseSeen.add(id);continue;
    }
    if (ix.programId.toBase58()!==COMPUTE || ix.keys.length!==0) throw Error('Wallet added non-Compute-Budget instruction outside original block');
    const data=Buffer.from(ix.data), variant=data[0];
    if (![1,2,3,4].includes(variant) || data.length!==(variant===3 ? 9 : 5)) throw Error('Unsupported Compute Budget instruction');
    if (seen.has(variant)) throw Error('Duplicate Compute Budget instruction');
    seen.add(variant);
    if (variant===3) continue; // Existing final transaction fee cap still applies.
    const value=data.readUInt32LE(1);
    if (variant===1 && (value<32768 || value>262144 || value%1024!==0)) throw Error('Unsafe heap frame');
    if (variant===2 && (value<1000 || value>1400000)) throw Error('Unsafe compute limit');
    if (variant===4 && (value<1 || value>67108864)) throw Error('Unsafe loaded account data limit');
  }
}
