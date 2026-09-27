// Private service-binding receiver. No signing, transactions, caller-selected URLs or retries.
const METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_call']);
const PUBLIC_RPC = 'https://mainnet.base.org';
const MAX_REQUEST = 4096;
const MAX_RESPONSE = 65536;
const TIMEOUT_MS = 8000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/;
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
class Rejected extends Error { constructor(status) { super('Rejected'); this.status = status; } }
function keys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function validCall(call) {
  if (!keys(call, ['to','data','gas']) || typeof call.to !== 'string' || typeof call.gas !== 'string' || !ADDRESS.test(call.to) || typeof call.data !== 'string' ||
      !DATA.test(call.data) || !QUANTITY.test(call.gas) || BigInt(call.gas) < 1n || BigInt(call.gas) > 500000n) return false;
  const data = call.data.slice(2).toLowerCase();
  if (!data.startsWith('1626ba7e') || data.length < 200 || data.slice(72,136) !== '0'.repeat(62)+'40') return false;
  const size = BigInt('0x'+data.slice(136,200));
  if (size > 512n || data.length !== 200 + Math.ceil(Number(size)/32)*64) return false;
  const signature = data.slice(200,200+Number(size)*2);
  return !signature.endsWith('6492'.repeat(16)) && /^0*$/.test(data.slice(200+Number(size)*2));
}
function validate(body) {
  if (!keys(body,['jsonrpc','id','method','params']) || body.jsonrpc !== '2.0' ||
      !(Number.isSafeInteger(body.id) || (typeof body.id === 'string' && body.id.length <= 64)) || !Array.isArray(body.params)) throw new Rejected(400);
  if (!METHODS.has(body.method)) throw new Rejected(403);
  const p=body.params;
  if (body.method === 'eth_chainId' || body.method === 'eth_blockNumber') {
    if(p.length) throw new Rejected(400);
  } else if (p.length !== 2 || typeof p[1] !== 'string' || !QUANTITY.test(p[1]) ||
      (body.method === 'eth_getCode' ? typeof p[0] !== 'string' || !ADDRESS.test(p[0]) : !validCall(p[0]))) throw new Rejected(400);
  return body;
}
async function boundedBody(message, limit, signal) {
  if(Number(message.headers.get('content-length')) > limit) throw new Rejected(413);
  if(!message.body) throw new Rejected(400);
  const reader=message.body.getReader(), chunks=[]; let size=0;
  const abort=()=>{reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try {
    for(;;) {
      if(signal.aborted) throw Error('timeout');
      const {done,value}=await reader.read();
      if(signal.aborted) throw Error('timeout');
      if(done)break;
      size+=value.length;if(size>limit)throw new Rejected(413);chunks.push(value);
    }
  } finally {signal.removeEventListener('abort',abort);await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function endpoint(env) {
  if(env.BASE_RPC_URL !== undefined) {
    if(typeof env.BASE_RPC_URL !== 'string' || !env.BASE_RPC_URL)throw Error('configuration');
    const url=new URL(env.BASE_RPC_URL);
    if(url.protocol!=='https:' || url.username || url.password || url.hash)throw Error('configuration');
    return url.href;
  }
  if(env.ALLOW_PUBLIC_BASE_RPC === 'true')return PUBLIC_RPC;
  throw Error('configuration');
}
function reply(status, id = null, result) {
  const body=JSON.stringify(result === undefined ?
    {jsonrpc:'2.0',id,error:{code:-32000,message:'Base signature RPC request rejected or unavailable'}} :
    {jsonrpc:'2.0',id,result});
  if(new TextEncoder().encode(body).length>MAX_RESPONSE)return reply(502);
  return new Response(body,{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export default {
  async fetch(request, env) {
    // No browser endpoint or CORS. Cloudflare routing/binding configuration is the access boundary.
    if(request.headers.has('Origin'))return reply(403);
    if(request.method!=='POST' || new URL(request.url).pathname!=='/')return reply(404);
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')||''))return reply(415);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
    let timeoutHandler;
    try {
      const operation=(async()=>{
        let body;
        try {body=JSON.parse(await boundedBody(request,MAX_REQUEST,controller.signal));}
        catch(error){if(error instanceof Rejected)throw error;throw new Rejected(400);}
        const input=validate(body);
        let url;try{url=endpoint(env);}catch{throw new Rejected(503);}
        async function rpc(method,params) {
          if(controller.signal.aborted)throw Error('timeout');
          const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'manual',signal:controller.signal});
          // Never return upstream headers, bodies, URL, error text or provider credentials.
          if(response.status!==200){controller.abort();throw Error('upstream');}
          let output;try{output=JSON.parse(await boundedBody(response,MAX_RESPONSE,controller.signal));}catch{throw Error('upstream');}
          if(!keys(output,['jsonrpc','id','result']) || output.jsonrpc!=='2.0' || output.id!==1)throw Error('upstream');
          return output.result;
        }
        // Verify the exact same endpoint before every request. No cached approval or automatic failover.
        if(await rpc('eth_chainId',[])!=='0x2105')throw Error('wrong chain');
        const result=input.method==='eth_chainId'?'0x2105':await rpc(input.method,input.params);
        if(typeof result!=='string' ||
          (input.method==='eth_blockNumber' && !QUANTITY.test(result)) ||
          (input.method==='eth_getCode' && !DATA.test(result)) ||
          (input.method==='eth_call' && !/^0x[0-9a-fA-F]{64}$/.test(result)))throw Error('upstream');
        return reply(200,input.id,result);
      })();
      const deadline=new Promise((_,reject)=>{timeoutHandler=()=>reject(Error('timeout'));controller.signal.addEventListener('abort',timeoutHandler,{once:true});if(controller.signal.aborted)timeoutHandler();});
      return await Promise.race([operation,deadline]);
    } catch(error) {
      return reply(error instanceof Rejected?error.status:502);
    } finally {clearTimeout(timer);controller.signal.removeEventListener('abort',timeoutHandler);controller.abort();}
  }
};
