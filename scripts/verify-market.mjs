// Read-only chain access; only the reviewed repository file can be written.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { getAddress } from 'ethers';
import { randomUUID } from 'node:crypto';
import { adapter } from '../web/adapters/base.js';
import { validateRegistry, OFFICIAL_BASE_FACTORY, tokenTrust } from '../web/verification.js';
export const REVIEW_CHECKS = [
  'I checked the project is not impersonating another project.',
  'I manually checked all submitted website/X/Telegram/Discord links and they correspond to the project.',
  'I reviewed the actual metadata: name, ticker, description, image and optional banner are present/consistent.',
  'I checked for misleading or conflicting/duplicate identity details.'
];
export function reviewedEntry(registry, market, confirmations, note='', now=Date.now()) {
  validateRegistry(registry,now);
  if(!tokenTrust('base',{chainId:8453,factory:OFFICIAL_BASE_FACTORY},market,registry,now).created) throw Error('Official factory provenance required');
  if(!market.uri) throw Error('Metadata is required for verification');
  if(confirmations.length!==REVIEW_CHECKS.length || confirmations.some(v=>v!==true)) throw Error('All manual identity review checks must be confirmed');
  const entry={status:'verified',market:getAddress(market.id),token:getAddress(market.token),creator:getAddress(market.creator),name:market.name,symbol:market.symbol,metadataURI:market.uri,reviewedAt:new Date(now).toISOString(),note};
  const next={version:1,base:{...registry.base,[market.id.toLowerCase()]:entry}};
  return validateRegistry(next,now);
}
export async function main(args=process.argv.slice(2)) {
  const [operation,input,...notes]=args;
  if(!['verify','remove'].includes(operation) || !input || (operation==='remove' && notes.length)) throw Error('Usage: node scripts/verify-market.mjs verify <market> [note] | remove <market>');
  const id=getAddress(input), path=resolve('web/verified-tokens.json');
  const original=await readFile(path,'utf8'), registry=validateRegistry(JSON.parse(original));
  let next;
  if(operation==='remove') { next={version:1,base:{...registry.base}}; delete next.base[id.toLowerCase()]; }
  else {
    if(!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Verification requires the maintainer’s interactive manual review; no automatic approvals');
    const config=JSON.parse(await readFile('config.json','utf8'));
    if(config.base.chainId!==8453 || config.base.factory.toLowerCase()!==OFFICIAL_BASE_FACTORY) throw Error('Official Base Mainnet factory configuration required');
    const reader=adapter(config.base,()=>{});
    let market;
    try { market=await reader.market(id); } finally { reader.close(); }
    console.log(JSON.stringify({chainId:8453,factory:config.base.factory,market:id,token:market.token,creator:market.creator,name:market.name,symbol:market.symbol,metadataURI:market.uri,block:market.provenance.block},null,2));
    const terminal=createInterface({input:process.stdin,output:process.stdout});
    const checks=[];
    try { for(const check of REVIEW_CHECKS) checks.push((await terminal.question(check+' Type yes: ')).trim()==='yes'); }
    finally {terminal.close();}
    next=reviewedEntry(registry,market,checks,notes.join(' '));
  }
  if(await readFile(path,'utf8')!==original) throw Error('Registry changed while reviewing; retry without overwriting it');
  const temporary=path+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(next,null,2)+'\n',{flag:'wx'});
  await rename(temporary,path);
  console.log('Updated local registry only. Review the Git diff, rebuild Pages and run checks before publishing. No transaction or wallet used.');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(e=>{console.error(e.message);process.exitCode=1;});
