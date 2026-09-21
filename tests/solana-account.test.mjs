import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Connection, PublicKey } from '@solana/web3.js';
import { adapter } from '../web/adapters/solana.js';
import { createInstructions, discriminator } from '../web/solana-instructions.js';
import { SOL_SUPPLY } from '../web/math.js';
const config = JSON.parse(await readFile('config.json')).solana;
const programId = new PublicKey('7yCAWc9Tk8F5eTjn731ZZKxNypoBrbaXvFEm6c9z8ybY');
const owner = new PublicKey('11111111111111111111111111111112');
async function fixture(t) {
  const nonce = Buffer.alloc(8, 1), name = '<img src=x onerror=alert(1)>', symbol = 'SAFE', uri = 'https://example.invalid/' + 'x'.repeat(175);
  const built = await createInstructions({ owner, nonce, programId, name, symbol, uri });
  const data = Buffer.alloc(368); (await discriminator('account:Market')).copy(data);
  data[8] = 1; data[9] = PublicKey.findProgramAddressSync([Buffer.from('market'), built.mint.toBuffer()], programId)[1];
  owner.toBuffer().copy(data,10); built.mint.toBuffer().copy(data,42); nonce.copy(data,74);
  data.writeBigUInt64LE(SOL_SUPPLY,90);
  let offset = 114;
  for (const text of [name,symbol,uri]) { const bytes=Buffer.from(text);data.writeUInt32LE(bytes.length,offset);offset+=4;bytes.copy(data,offset);offset+=bytes.length; }
  let account = {owner:programId,data};
  t.mock.method(Connection.prototype,'getGenesisHash',async()=>config.genesisHash);
  t.mock.method(Connection.prototype,'getAccountInfoAndContext',async()=>({value:account,context:{slot:123}}));
  return { client:adapter({...config,programId:programId.toBase58()},()=>{}),built,name,uri, data, set:value=>account=value };
}
test('Solana metadata and market bytes decode using the same creator/mint/market PDA derivation as creation',async t=>{
  const f=await fixture(t), market=await f.client.market(f.built.market.toBase58());
  assert.equal(market.name,f.name);assert.equal(market.uri,f.uri);assert.equal(market.tokenReserve,SOL_SUPPLY);
  assert.equal(market.source,'Solana confirmed slot 123');
});
test('Solana reads reject malformed identities, seeds, owners, UTF-8 and reserve values',async t=>{
  const f=await fixture(t);
  const cases=[{owner,data:f.data},{owner:programId,data:f.data.subarray(0,367)},null];
  for(const index of [0,8,9,10,42,74]) {const data=Buffer.from(f.data);data[index]^=255;cases.push({owner:programId,data});}
  const excessive=Buffer.from(f.data);excessive.writeBigUInt64LE(SOL_SUPPLY+1n,90);cases.push({owner:programId,data:excessive});
  const utf8=Buffer.from(f.data);utf8[118]=255;cases.push({owner:programId,data:utf8});
  for(const value of cases){f.set(value);await assert.rejects(f.client.market(f.built.market.toBase58()));}
});
