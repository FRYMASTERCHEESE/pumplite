import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';

// Test-only bundle; never enters the public Pages export.
export async function verifyRedesignBrowser(browser, base) {
  const bundle=await build({entryPoints:['web/price-chart.js'],bundle:true,write:false,format:'iife',globalName:'ChartFixture',platform:'browser'});
  await mkdir('build/screenshots/redesign',{recursive:true});
  for(const width of [390,768,1440]) {
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    // Block every external request. No wallet, signature, chain write or registry write.
    await page.route('**/*',route=>{
      const url=route.request().url();
      if(url===base+'__chart-fixture.js')return route.fulfill({contentType:'application/javascript',body:bundle.outputFiles[0].text});
      if(url.startsWith(base))return route.continue();
      if(url.includes('/mayhem/capabilities'))return route.fulfill({json:{version:1,enabled:false,mode:'manual',processorConfigured:false,broadcastEnabled:false}});
      return route.fulfill({status:503,body:'Read unavailable in offline fixture'});
    });
    await page.goto(base,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.documentElement.dataset.walletAppReady==='ready');
    const navigation=width<=740?'[data-page="':'#show-';
    async function go(name) {
      const ids={markets:'explore',portfolio:'portfolio',create:'create',help:'help',home:'home'};
      await page.locator(width<=740?navigation+name+'"]':navigation+ids[name]).click();
    }
    for(const [name,target] of [['home','home-overview'],['markets','explore-section'],['create','create-section'],['portfolio','portfolio-section'],['help','help-section']]) {
      await go(name);
      assert.equal(await page.locator('#'+target).isVisible(),true,name+' route at '+width);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow: '+name);
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:'build/screenshots/redesign/'+name+'-'+width+'.png',fullPage:true});
    }
    assert.equal(await page.locator('.bottom-nav').isVisible(),width<=740);
    assert.equal(await page.locator('.home-page-tabs').isVisible(),width>740);
    await go('portfolio');
    await page.locator('#portfolio-refresh').click();
    assert.match(await page.locator('#portfolio-status').textContent(),/Connect your wallet/);
    await go('help');
    assert.match(await page.locator('.wallet-guide').textContent(),/Phantom/);
    assert.match(await page.locator('.wallet-guide').textContent(),/Coinbase/);
    await go('home');
    // Exercise the exact chart module using explicit synthetic test data only.
    await page.addScriptTag({url:base+'__chart-fixture.js'});
    await page.evaluate(()=>{
      document.querySelector('#home').hidden=true;
      document.querySelector('#market-page').hidden=false;
      document.querySelector('#market-name').textContent='OFFLINE CHART FIXTURE';
      window.chartTestTrades=[{price:4000000n,timestamp:1700000000,blockNumber:1,isBuy:true},{price:8000000n,timestamp:1700000030,blockNumber:2,isBuy:true},{price:2000000n,timestamp:1700000150,blockNumber:3,isBuy:false}];
      window.ChartFixture.renderPriceChart(document.querySelector('#price-chart'),window.chartTestTrades,'FIXTURE',9,'SOL');
    });
    const svg=page.locator('#price-chart svg');
    await svg.focus();
    await svg.press('Home');
    assert.match(await page.locator('.chart-inspector').textContent(),/0.004/);
    await svg.press('End');
    assert.match(await page.locator('.chart-inspector').textContent(),/0.002/);
    assert.equal(await page.locator('.trend-line.trend-down').count(),1);
    await page.screenshot({path:'build/screenshots/redesign/line-'+width+'.png',fullPage:true});
    await page.evaluate(()=>window.ChartFixture.renderPriceChart(document.querySelector('#price-chart'),window.chartTestTrades,'FIXTURE',9,'SOL',{style:'candles',range:'LIVE'}));
    assert.equal(await page.locator('.candle-body').count(),2);
    const bounds=await page.locator('#price-chart svg').boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+60);
    assert.match(await page.locator('.chart-inspector').textContent(),/O .* H .* L .* C /);
    await page.screenshot({path:'build/screenshots/redesign/candles-'+width+'.png',fullPage:true});
    await page.evaluate(()=>window.ChartFixture.renderPriceChart(document.querySelector('#price-chart'),[],'FIXTURE',9,'SOL'));
    assert.match(await page.locator('#price-chart').textContent(),/No real on-chain trades/);
    assert.equal(await page.locator('#price-chart svg').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS redesign '+width+'px: navigation, portfolio disconnected, wallet guidance, overflow, line/candle interaction, empty history; all external traffic mocked');
    await context.close();
  }
}
