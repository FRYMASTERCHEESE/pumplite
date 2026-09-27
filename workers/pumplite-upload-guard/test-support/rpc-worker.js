// Only used by the isolated local test configuration, never production.
export default {async fetch(request) {
 const data=await request.json();
 if(!['eth_chainId','eth_blockNumber','eth_getCode','eth_call'].includes(data.method))return new Response(null,{status:403});
 return fetch('http://127.0.0.1:18545',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}};
