(() => {
  'use strict';
  // This module performs only public eth_chainId / eth_blockNumber / eth_call
  // reads. It has NO signer, wallet provider, storage, submit or write methods.
  if (window.top !== window.self) return;
  const $=id=>document.getElementById(id);
  const PAIR='0xdad81f9f5dbf71ce54d63f96ee45231d97d6b086';
  const PLITE='0xb15a460142c77b42cdf57815b0eefe b24b593196'.replace(' ','');
  const WETH='0x4200000000000000000000000000000000000006';
  const FACTORY='0x8909dc15e40173ff4699343b6eb8132c65e18ec6';
  const RPCS=['https://base-rpc.publicnode.com','https://mainnet.base.org'];
  const HEX=/^0x[0-9a-f]+$/i;
  const MAX112=(1n<<112n)-1n;
  const FRESH_MS=45_000;
  let active=0,snapshot=null;
  function setStatus(message){$('pool-auto-status').textContent=message;}
  function clearSuggested(message) {
    $('pool-auto-result').textContent=message;
  }
  function words(value,count) {
    if(typeof value!=='string'||!HEX.test(value)||value.length!==2+64*count)
      throw Error('Base RPC returned malformed on-chain contract data.');
    return Array.from({length:count},(_,i)=>value.slice(2+i*64,2+(i+1)*64));
  }
  function address(value) {return '0x'+words(value,1)[0].slice(24).toLowerCase();}
  function decimalAtomic(value,unit) {
    const raw=String(value||'').trim();
    if(raw.length>32||!/^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/.test(raw))
      throw Error('Enter a nonnegative ordinary '+unit+' decimal amount with no commas.');
    const [whole,fraction='']=raw.split('.');
    if(fraction.length>18)throw Error(unit+' amount cannot exceed 18 decimal places.');
    const atomic=BigInt(whole+fraction.padEnd(18,'0'));
    if(atomic===0n)throw Error('Enter a positive '+unit+' amount before auto-match.');
    if(atomic>10n**30n)throw Error(unit+' planning amount is too large.');
    return atomic;
  }
  function displayAtomic(amount) {
    const str=(amount/(10n**18n)).toString()+'.'+(amount%(10n**18n)).toString().padStart(18,'0');
    return str.replace(/\.?0+$/,'') || '0';
  }
  async function fetchSnapshot(url){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),9000);
    try {
      let counter=0;
      async function rpc(method,params=[]) {
        const response=await fetch(url,{
          method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({jsonrpc:'2.0',id:++counter,method,params}),
          signal:controller.signal
        });
        if(!response.ok)throw Error('Base RPC read unavailable (HTTP '+response.status+').');
        const content=await response.text();
        if(content.length>16000)throw Error('Base RPC response exceeds read limit.');
        const body=JSON.parse(content);
        if(body.error||typeof body.result!=='string')throw Error('Base RPC rejected the public read.');
        return body.result;
      }
      const chain=await rpc('eth_chainId');
      if(chain!=='0x2105')throw Error('Refusing pool data: RPC is not Base Mainnet (8453).');
      const blockHex=await rpc('eth_blockNumber');
      if(!/^0x[0-9a-f]{1,16}$/i.test(blockHex))throw Error('Base RPC returned an invalid block.');
      const block=BigInt(blockHex);
      if(block<1n||block>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Base block is out of range.');
      const read=selector=>rpc('eth_call',[{to:PAIR,data:selector},blockHex]);
      const [zero,one,factoryRaw,reserveRaw]=await Promise.all([
        read('0x0dfe1681'),read('0xd21220a7'),read('0xc45a0155'),read('0x0902f1ac')
      ]);
      if(address(factoryRaw)!==FACTORY)throw Error('Pair factory is not the canonical Base Uniswap V2 factory.');
      const token0=address(zero),token1=address(one);
      if(!((token0===PLITE&&token1===WETH)||(token0===WETH&&token1===PLITE)))
        throw Error('Pair tokens do not match the official PLITE/WETH addresses.');
      const [w0,w1]=words(reserveRaw,3);
      const r0=BigInt('0x'+w0),r1=BigInt('0x'+w1);
      if(r0<=0n||r1<=0n||r0>MAX112||r1>MAX112)
        throw Error('The verified PLITE/WETH pool has empty or invalid reserves.');
      return {plite:token0===PLITE?r0:r1,weth:token0===WETH?r0:r1,block:Number(block),loadedAt:Date.now()};
    } finally {clearTimeout(timer);}
  }
  async function refresh(){
    const request=++active;
    snapshot=null;$('pool-auto-refresh').disabled=true;$('pool-auto-fill').disabled=true;
    clearSuggested('Waiting for verified Base pool reserves. No automatic deposit will take place.');
    setStatus('Reading the official PLITE/WETH reserves from Base Mainnet…');
    let error=null;
    try {
      for(const rpc of RPCS) {
        try {
          const fresh=await fetchSnapshot(rpc);
          if(request!==active)return;
          snapshot=fresh;
          $('pool-auto-fill').disabled=false;
          setStatus('Verified PLITE/WETH reserves at Base block '+fresh.block.toLocaleString()+
            '. PLITE reserve '+displayAtomic(fresh.plite)+'; WETH reserve '+displayAtomic(fresh.weth)+'. Live read only; no funds moved.');
          clearSuggested('Enter one contribution amount, then Auto-match other amount. Refresh again before any real transaction.');
          return;
        }catch(e){error=e;}
      }
      if(request!==active)return;
      setStatus('Verified pool read unavailable: '+(error?.message||'RPC unavailable')+'. No matching amount will be invented. Retry later or check the pair in Uniswap.');
    }finally{if(request===active)$('pool-auto-refresh').disabled=false;}
  }
  function match(){
    if(!snapshot||Date.now()-snapshot.loadedAt>FRESH_MS){
      $('pool-auto-fill').disabled=true;
      clearSuggested('Read a fresh verified pool snapshot first; matching is disabled when data is stale.');
      return;
    }
    try {
      const source=$('pool-auto-source').value;
      if(source!=='plite'&&source!=='weth')throw Error('Unknown source token.');
      const target=source==='plite'?'weth':'plite';
      const amount=decimalAtomic($('plan-'+source).value,source.toUpperCase());
      // Ceil to avoid quoting a zero side for very small inputs.
      const matched=(amount*snapshot[target]+snapshot[source]-1n)/snapshot[source];
      if(matched<=0n)throw Error('Matched token amount rounds to zero.');
      const value=displayAtomic(matched);
      if(value.length>32)throw Error('Matched token amount exceeds the planner input limit.');
      $('plan-'+target).value=value;
      const note='Auto-matched '+value+' '+target.toUpperCase()+' from the verified pool at Base block '+
        snapshot.block.toLocaleString()+'. This is not a deposit or executable quote. Review your full plan again, then verify current amounts in Uniswap.';
      clearSuggested(note);
      const output=$('plan-output');
      output.replaceChildren();
      const p=document.createElement('p');p.className='muted';p.textContent='Matched contribution changed. Review the complete plan again; no transaction was submitted.';output.append(p);
    }catch(e){clearSuggested(e?.message||'Unable to match amount.');}
  }
  $('pool-auto-refresh').addEventListener('click',()=>{void refresh();});
  $('pool-auto-fill').addEventListener('click',match);
  for(const id of ['plan-plite','plan-weth']){
    $(id).addEventListener('input',()=>{
      if(snapshot)clearSuggested('One contribution amount changed. Auto-match again before reviewing your plan.');
    });
  }
  $('pool-auto-source').addEventListener('change',()=>clearSuggested('Enter the '+$('pool-auto-source').value.toUpperCase()+' amount and Auto-match the other token.'));
  // Automated READS only. The static local CI fixture never contacts a real RPC.
  const production=location.protocol==='https:'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1';
  if(production)void refresh();
})();