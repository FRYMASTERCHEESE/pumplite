import assert from 'node:assert/strict';

export async function verifyPlitePoolAutoBrowser(browser,base) {
 for(const width of [390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'liquidity.html',{waitUntil:'networkidle'});
  assert.equal(await page.locator('#pool-auto-fill').isDisabled(),true,'no fabricated pool amounts before a fresh read');
  await page.evaluate(()=>{
    window.__wrongPool=false;
    const oldFetch=window.fetch.bind(window);
    window.fetch=async(url,opts)=>{
      if(!['https://base-rpc.publicnode.com','https://mainnet.base.org'].includes(String(url)))return oldFetch(url,opts);
      const request=JSON.parse(opts.body);
      const word=v=>BigInt(v).toString(16).padStart(64,'0');
      const addr=a=>'0x'+a.toLowerCase().replace('0x','').padStart(64,'0');
      const TOKEN='0xb15a460142c77b42cdf57815b0eefeb24b593196';
      const WETH='0x4200000000000000000000000000000000000006';
      const factory='0x8909dc15e40173ff4699343b6eb8132c65e18ec6';
      const wrong='0x0000000000000000000000000000000000000009';
      let result;
      if(request.method==='eth_chainId')result='0x2105';
      else if(request.method==='eth_blockNumber')result='0x12ab34';
      else if(request.method==='eth_call'){
        const selector=request.params[0].data;
        if(selector==='0x0dfe1681')result=addr(WETH);
        else if(selector==='0xd21220a7')result=addr(window.__wrongPool?wrong:TOKEN);
        else if(selector==='0xc45a0155')result=addr(factory);
        else if(selector==='0x0902f1ac')result='0x'+word(2_000_000_000_000_000n)+word(1_000_000n*(10n**18n))+word(0);
        else throw Error('Unexpected selector '+selector);
      }else throw Error('Unexpected read method '+request.method);
      return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200,headers:{'content-type':'application/json'}});
    };
  });
  await page.locator('#pool-auto-refresh').click();
  await page.waitForFunction(()=>document.querySelector('#pool-auto-status').textContent.includes('Verified PLITE/WETH reserves at Base block'));
  assert.equal(await page.locator('#pool-auto-fill').isDisabled(),false);
  assert.match(await page.locator('#pool-auto-status').textContent(),/PLITE reserve 1000000; WETH reserve 0.002/);
  await page.locator('#plan-plite').fill('1000');
  await page.locator('#pool-auto-fill').click();
  assert.equal(await page.locator('#plan-weth').inputValue(),'0.000002');
  assert.match(await page.locator('#pool-auto-result').textContent(),/Auto-matched 0.000002 WETH/);
  await page.locator('#pool-auto-source').selectOption('weth');
  await page.locator('#plan-weth').fill('0.000004');
  await page.locator('#pool-auto-fill').click();
  assert.equal(await page.locator('#plan-plite').inputValue(),'2000');
  await page.locator('#plan-review').click();
  assert.match(await page.locator('#plan-output').textContent(),/2000 PLITE and 0.000004 WETH/);
  await page.locator('#plan-weth').fill('0.0000000000000000001');
  await page.locator('#pool-auto-fill').click();
  assert.match(await page.locator('#pool-auto-result').textContent(),/cannot exceed 18 decimal places/);
  await page.evaluate(()=>{window.__wrongPool=true;});
  await page.locator('#pool-auto-refresh').click();
  await page.waitForFunction(()=>document.querySelector('#pool-auto-status').textContent.includes('Verified pool read unavailable'));
  assert.equal(await page.locator('#pool-auto-fill').isDisabled(),true,'incorrect onchain token identity fails closed');
  assert.match(await page.locator('#pool-auto-status').textContent(),/Pair tokens do not match/);
  assert.deepEqual(errors,[],'no runtime errors in read-only ratio matching at '+width+'px');
  await context.close();
  console.log('PASS PLITE pool ratio auto-read '+width+'px: chain/factory/token verification, reciprocal exact matching, decimals and mismatch failure; network mocked, no wallet signatures');
 }
}
