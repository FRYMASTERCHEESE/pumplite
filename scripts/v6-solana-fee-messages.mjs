// Estimation-only unsigned messages. No private keys, signatures or submission.
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const placeholder = label => new PublicKey(createHash('sha256').update('PumpLite V6 COST ESTIMATION ONLY ' + label).digest());
export function feeMessages(binary, authority, blockhash) {
  const buffer = placeholder('buffer'), program = placeholder('program');
  const encode = instructions => {
    const tx = new Transaction({feePayer:authority,recentBlockhash:blockhash}).add(...instructions);
    const packet = tx.serialize({requireAllSignatures:false,verifySignatures:false});
    if (packet.length > 1232 || tx.signatures.some(s=>s.signature!==null)) throw Error('Invalid unsigned fee fixture');
    return tx.serializeMessage().toString('base64');
  };
  const writes = [];
  for (let offset=0;offset<binary.length;offset+=900) {
    const chunk=binary.subarray(offset,offset+900), header=Buffer.alloc(16);
    header.writeUInt32LE(1,0); header.writeUInt32LE(offset,4); header.writeBigUInt64LE(BigInt(chunk.length),8);
    writes.push(encode([new TransactionInstruction({programId:loader,
      keys:[{pubkey:buffer,isSigner:false,isWritable:true},{pubkey:authority,isSigner:true,isWritable:false}],
      data:Buffer.concat([header,chunk])})]));
  }
  // Only fee message signatures/packet size are relevant to getFeeForMessage.
  // Values here are zero rent placeholders; this is not an executable deployment package.
  const createBuffer=encode([SystemProgram.createAccount({fromPubkey:authority,newAccountPubkey:buffer,
    lamports:0,space:binary.length+37,programId:loader}),new TransactionInstruction({programId:loader,
    keys:[{pubkey:buffer,isSigner:false,isWritable:true},{pubkey:authority,isSigner:false,isWritable:false}],data:Buffer.alloc(4)})]);
  const data=Buffer.alloc(12);data.writeUInt32LE(2,0);data.writeBigUInt64LE(BigInt(binary.length),4);
  const programData=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const deploy=encode([SystemProgram.createAccount({fromPubkey:authority,newAccountPubkey:program,
    lamports:0,space:36,programId:loader}),new TransactionInstruction({programId:loader,
    keys:[{pubkey:authority,isSigner:true,isWritable:true},{pubkey:programData,isSigner:false,isWritable:true},
      {pubkey:program,isSigner:false,isWritable:true},{pubkey:buffer,isSigner:false,isWritable:true},
      {pubkey:new PublicKey('SysvarRent111111111111111111111111111111111'),isSigner:false,isWritable:false},
      {pubkey:new PublicKey('SysvarC1ock11111111111111111111111111111111'),isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:authority,isSigner:true,isWritable:false}],data})]);
  return {createBuffer,deploy,writes};
}
