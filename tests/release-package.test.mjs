import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPackage } from '../scripts/release-package.mjs';
const commit='a'.repeat(40);
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'pumplite-artifact-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paths=['target/deploy/pumplite.so','target/idl/pumplite.json','Cargo.lock','tests/fixtures/metaplex/provenance.json','build/sbf-reproducibility.json','build/rustsec-audit.json'];
 const m={schemaVersion:1,commit,canonical:true,dirty:false,profile:'ubuntu-24.04-x86_64',programId:'build-identity',treasuries:{solana:'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct',base:'0x0de7fdcc798f7fac6b03b366c529133a9c60794d'},files:[]};
 for(const path of paths){const b=path.endsWith('.so')?Buffer.from([127,69,76,70]):Buffer.from(path.endsWith('pumplite.json')?JSON.stringify({address:m.programId}):'fixture');await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),b);m.files.push({path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
 const save=()=>writeFile(join(root,'release-solana.json'),JSON.stringify(m));await save();return {root,m,save};
}
test('offline complete release verifies only for independently supplied matching commit',async t=>{const {root}=await fixture(t);await verifyPackage(root,'solana',commit);await assert.rejects(verifyPackage(root,'solana','b'.repeat(40)),/Wrong commit/);});
for(const fault of ['missing','altered','duplicate','traversal','empty','dirty','noncanonical','treasury','identity'])test('offline release rejects '+fault,async t=>{
 const {root,m,save}=await fixture(t);
 if(fault==='missing')await rm(join(root,'Cargo.lock'));
 if(fault==='altered')await writeFile(join(root,'Cargo.lock'),'tampered');
 if(fault==='duplicate')m.files[1]=m.files[0];
 if(fault==='traversal')m.files[0].path='../outside';
 if(fault==='empty')m.files=[];
 if(fault==='dirty')m.dirty=true;
 if(fault==='noncanonical')m.canonical=false;
 if(fault==='treasury')m.treasuries.base='wrong';
 if(fault==='identity')m.programId='wrong';
 await save();await assert.rejects(verifyPackage(root,'solana',commit));
});
