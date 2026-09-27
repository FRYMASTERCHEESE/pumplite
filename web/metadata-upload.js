// Prepared client only: no automatic upload, credential storage or wallet access.
// Authorization is a short-lived upload grant, NEVER a Pinata/Helius credential.
import { boundedFetch } from './rpc-fetch.js';
const BASE = 'https://pumplite-rpc.coreyedge123.workers.dev';
export async function uploadMetadataPart(config, kind, body, authorization) {
  if(config?.enabled!==true) throw Error('Metadata uploads are not enabled');
  if(!['image','json'].includes(kind)) throw Error('Invalid metadata upload');
  if(!/^Bearer [A-Za-z0-9._~-]{16,2048}$/.test(authorization||'')) throw Error('Upload authorization required');
  const bytes=kind==='image'?body:JSON.stringify(body);
  if(kind==='image' && (!(body instanceof Blob) || body.type!=='image/png' || body.size>512*1024)) throw Error('Use a PNG no larger than 512 KiB');
  if(kind==='json' && new TextEncoder().encode(bytes).length>4096) throw Error('Metadata too large');
  const response=await boundedFetch(BASE+'/metadata/'+kind,{method:'POST',headers:{'Content-Type':kind==='image'?'image/png':'application/json',Authorization:authorization},body:bytes},{timeout:20000,maxBytes:1024});
  const result=await response.json();
  if(typeof result.cid!=='string' || !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})$/.test(result.cid) || result.uri!=='ipfs://'+result.cid) throw Error('Invalid metadata response');
  return {cid:result.cid,uri:result.uri};
}
