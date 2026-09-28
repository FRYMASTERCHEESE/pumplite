import { metadataExtras } from '../../web/metadata-fields.js';
const IMAGE_LIMIT = 512 * 1024;
const JSON_LIMIT = 4096;
const PINATA = 'https://uploads.pinata.cloud/v3/files';
const encoder = new TextEncoder();
class Invalid extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function validCid(value) {
  // Pinata's CIDv0 or lowercase base32 CIDv1, with SHA-256 digest.
  return typeof value === 'string' && (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value) || /^b[a-z2-7]{58}$/.test(value));
}
async function limitedBody(response, max, controller) {
  if (Number(response.headers.get('content-length')) > max) throw new Invalid('Request too large', 413);
  if (!response.body) throw new Invalid('Missing body');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  const abort = () => { reader.cancel().catch(() => {}); };
  controller.signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      if (controller.signal.aborted) throw Error('timeout');
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw Error('timeout');
      if (done) break;
      size += value.length;
      if (size > max) throw new Invalid('Request too large', 413);
      chunks.push(value);
    }
  } finally { controller.signal.removeEventListener('abort', abort); await reader.cancel(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export async function validatePng(bytes, controller = new AbortController()) {
  const compressed=[]; let width, height, channels;
  if (bytes.length < 57 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) throw new Invalid('Invalid PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, header = false, data = false, palette = false, transparency = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset), end = offset + 12 + size;
    if (end > bytes.length) throw new Invalid('Invalid PNG');
    const type = String.fromCharCode(...bytes.subarray(offset+4,offset+8));
    if (!['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type)) throw new Invalid('Export a plain PNG without animation or metadata chunks');
    let crc = 0xffffffff;
    for (let i=offset+4; i<end-4; i++) { crc ^= bytes[i]; for(let b=0;b<8;b++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
    if (((crc^0xffffffff)>>>0) !== view.getUint32(end-4)) throw new Invalid('Invalid PNG checksum');
    if (!header && type !== 'IHDR') throw new Invalid('Invalid PNG');
    if (type === 'IHDR') {
      if (header || size !== 13) throw new Invalid('Invalid PNG');
      const w=view.getUint32(offset+8), h=view.getUint32(offset+12);
      if (!w || !h || w>1024 || h>1024) throw new Invalid('PNG dimensions must be 1–1024 pixels');
      // Restrict to common noninterlaced 8-bit RGB/RGBA exports.
      if(bytes[offset+16]!==8 || ![2,6].includes(bytes[offset+17]) || bytes[offset+18] || bytes[offset+19] || bytes[offset+20]) throw new Invalid('Use an 8-bit RGB or RGBA noninterlaced PNG');
      width=w; height=h; channels=bytes[offset+17]===2?3:4; header=true;
    } else if (type === 'PLTE') {
      if(data || palette || transparency || !size || size>768 || size%3) throw new Invalid('Invalid PNG'); palette=true;
    } else if (type === 'tRNS') {
      if(data || transparency || bytes[25]!==2 || size!==6) throw new Invalid('Invalid PNG'); transparency=true;
    } else if (type === 'IDAT') { if(!size) throw new Invalid('Invalid PNG'); data=true; compressed.push(bytes.slice(offset+8,end-4)); }
    else if (type === 'IEND') {
      if(size || !data || end!==bytes.length) throw new Invalid('Invalid PNG');
      const stride=width*channels+1, expected=stride*height;
      try {
        const stream=new Blob(compressed).stream().pipeThrough(new DecompressionStream('deflate'));
        const pixels=await limitedBody(new Response(stream),expected,controller);
        if(pixels.length!==expected) throw Error('length');
        for(let row=0;row<height;row++) if(pixels[row*stride]>4) throw Error('filter');
      } catch { throw new Invalid('Invalid PNG pixel data'); }
      return;
    }
    offset=end;
  }
  throw new Invalid('Invalid PNG');
}
export function metadataBytes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!['name','symbol','description','imageCid','links','banner'].includes(k))) throw new Invalid('Invalid metadata fields');
  for (const [key,max] of [['name',32],['symbol',10],['description',2000]]) {
    if(typeof value[key] !== 'string' || encoder.encode(value[key]).length>max || /[\u0000-\u001f\u007f]/.test(value[key])) throw new Invalid('Invalid metadata fields');
  }
  if (!value.name.trim() || !/^[A-Z0-9]{1,10}$/.test(value.symbol) || !validCid(value.imageCid)) throw new Invalid('Invalid metadata fields');
  let extras; try { extras=metadataExtras(value.links,value.banner); } catch { throw new Invalid('Invalid social links or banner URI'); }
  const bytes=encoder.encode(JSON.stringify({ name:value.name, symbol:value.symbol, description:value.description, image:'ipfs://'+value.imageCid, ...extras }));
  if(bytes.length>JSON_LIMIT) throw new Invalid('Metadata too large',413);
  return bytes;
}
function abortable(promise, signal) {
  if(signal.aborted) return Promise.reject(Error('timeout'));
  let abort;
  return Promise.race([promise,new Promise((_,reject)=>{
    abort=()=>reject(Error('timeout'));signal.addEventListener('abort',abort,{once:true});
  })]).finally(()=>signal.removeEventListener('abort',abort));
}
export async function metadataRoute(request, env, path, headers) {
  const cors={...headers,'Access-Control-Allow-Headers':'Content-Type, Authorization'};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST') return reply({error:'Not found'},404);
  // A configured secret alone never enables a public upload relay.
  if(env.METADATA_UPLOADS_ENABLED!=='true' || !env.PINATA_JWT || typeof env.UPLOAD_GUARD?.fetch!=='function') return reply({error:'Metadata uploads unavailable'},503);
  const isImage=path==='/metadata/image', type=(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if(type!==(isImage?'image/png':'application/json')) return reply({error:'Unsupported Content-Type'},415);
  const authorization=request.headers.get('Authorization')||'';
  if(!/^Bearer [A-Za-z0-9._~-]{16,2048}$/.test(authorization)) return reply({error:'Upload authorization required'},401);
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
    const raw=await limitedBody(request,isImage?IMAGE_LIMIT:JSON_LIMIT,controller);
    let bytes=raw, imageCid;
    if(isImage) await validatePng(raw,controller);
    else {
      let value; try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)); } catch {throw new Invalid('Invalid metadata JSON');}
      bytes=metadataBytes(value); imageCid=value.imageCid;
    }
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    // Trusted service binding must atomically authorize/consume a single-use grant,
    // enforce durable quotas, and check imageCid ownership for JSON uploads.
    const grant=await abortable(env.UPLOAD_GUARD.fetch('https://upload-guard.internal/authorize',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization},
      body:JSON.stringify({path,bytes:bytes.length,sha256:digest,...(imageCid?{imageCid}:{})}),signal:controller.signal
    }),controller.signal);
    if(grant.status!==204) { controller.abort(); return reply({error:'Upload not authorized'},403); }
    const form=new FormData();
    form.set('network','public');
    form.set('file',new Blob([bytes],{type:isImage?'image/png':'application/json'}),isImage?'token-logo.png':'token-metadata.json');
    // No arbitrary URLs, retries, signed upload URLs or upstream response forwarding.
    let upstream;

    try {
      upstream=await abortable(fetch(PINATA,{
        method:'POST',
        headers:{Authorization:'Bearer '+env.PINATA_JWT},
        body:form,
        signal:controller.signal,
        redirect:'manual'
      }),controller.signal);
    } catch {
      return reply({
        error:'Metadata provider request failed',
        stage:'pinata_fetch'
      },502);
    }

    if(!upstream.ok) {
      return reply({
        error:'Metadata provider rejected upload',
        stage:'pinata_http',
        providerStatus:upstream.status
      },502);
    }

    let result;

    try {
      result=JSON.parse(
        new TextDecoder().decode(
          await limitedBody(upstream,8192,controller)
        )
      );
    } catch {
      return reply({
        error:'Metadata provider response invalid',
        stage:'pinata_response'
      },502);
    }

    const cid=result?.data?.cid;

    if(!validCid(cid)) {
      return reply({
        error:'Metadata provider CID invalid',
        stage:'pinata_cid'
      },502);
    }

    const stored=await abortable(
      env.UPLOAD_GUARD.fetch(
        'https://upload-guard.internal/complete',
        {
          method:'POST',
          headers:{
            'Content-Type':'application/json',
            Authorization:authorization
          },
          body:JSON.stringify({
            path,
            sha256:digest,
            cid
          }),
          signal:controller.signal
        }
      ),
      controller.signal
    );

    if(stored.status!==204) {
      return reply({
        error:'Metadata receipt rejected',
        stage:'receipt',
        receiptStatus:stored.status
      },502);
    }
    return reply({cid,uri:'ipfs://'+cid});
  } catch(error) {
    controller.abort();
    if(error instanceof Invalid) return reply({error:error.message},error.status);
    return reply({error:'Metadata service temporarily unavailable'},502);
  } finally {clearTimeout(timer);}
}
