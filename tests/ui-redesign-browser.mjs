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
    if (width <= 740) {
      assert.equal(await page.locator('#app-header-tools').isVisible(),true,
        'compact icon header at '+width);
      assert.equal(await page.locator('#app-search').isVisible(),true,
        'search icon at '+width);
      assert.equal(await page.locator('#app-feed-content').isVisible(),true,
        'genuine market feed at '+width);
      assert.equal(await page.locator('.app-feed-tabs button').count(),3,
        'Callouts, Following and Top tabs');
      await page.locator('[data-app-feed="following"]').click();
      assert.match(await page.locator('#app-feed-content').textContent(),/No coins followed yet/i);
      await page.locator('[data-app-feed="latest"]').click();
      // Synthetic market fixture; the production list remains genuine on-chain data.
      await page.evaluate(() => {
        const chain=document.querySelector('#chain').value;
        const market=chain==='base'?'0x'+'1'.repeat(40):'11111111111111111111111111111112';
        const card=document.createElement('a');
        card.className='token-market-card';
        card.setAttribute('href','#'+chain+'/'+market);
        card.innerHTML='<span class="token-card-identity"><b>Fixture Coin</b><span class="ticker">FX / SOL</span></span>'+
          '<span class="token-age">Now</span><span class="token-card-metrics"><span></span><span><strong>0.01 SOL</strong></span></span>';
        document.querySelector('#home-markets').append(card);
      });
      await page.waitForFunction(()=>!!document.querySelector('#app-feed-content .app-follow-toggle'));
      await page.locator('#app-feed-content .app-follow-toggle').first().click();
      assert.equal(await page.locator('#app-feed-content .app-follow-toggle').first().getAttribute('aria-pressed'),'true');
      const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('pumplite:followed-markets:v1')||'[]'));
      assert.equal(saved.length,1,'followed market stored locally without a wallet action');
      await page.locator('[data-app-feed="following"]').click();
      assert.match(await page.locator('#app-feed-content').textContent(),/Fixture Coin/);
      await page.locator('#app-feed-content .app-follow-toggle').click();
      assert.match(await page.locator('#app-feed-content').textContent(),/No coins followed yet/);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pumplite:followed-markets:v1')||'[]').length),0);
      await page.locator('[data-app-feed="latest"]').click();
      await page.locator('#app-search').click();
      assert.equal(await page.locator('#explore-section').isVisible(),true,
        'search icon opens existing markets');
      await page.locator('#market-filter').fill('PLITE');
      assert.equal(await page.locator('#market-filter').inputValue(),'PLITE');
      await page.locator('[data-app-sort="market-cap"]').click();
      assert.equal(await page.locator('#market-sort').inputValue(),'market-cap',
        'rank filter controls reviewed on-chain market sorting');
      await page.locator('#market-filter').fill('');
      await page.locator('.bottom-nav [data-page="create"]').click();
      assert.equal(await page.locator('#app-action-sheet').isVisible(),true);
      assert.equal(await page.locator('#app-sheet-items button').filter({hasText:'Create coin'}).count(),1);
      assert.equal(await page.locator('#app-sheet-items button').filter({hasText:'Post bounty'}).isDisabled(),true,
        'no fake bounty creation without payment backend');
      await page.locator('#app-sheet-close').click();
      await page.locator('.bottom-nav [data-page="help"]').click();
      assert.equal(await page.locator('#app-action-sheet').isVisible(),true);
      assert.equal(await page.locator('#app-sheet-items button').filter({hasText:'Leaderboard'}).count(),1);
      await page.locator('#app-sheet-close').click();
      await page.locator('.bottom-nav [data-page="home"]').click();
    } else {
      assert.equal(await page.locator('.terminal-header-links').isVisible(),true,
        'desktop Create and Explore links visible');
      assert.equal(await page.locator('.terminal-header-links .claim-header-link').isVisible(),true,
        'desktop Claim remains discoverable');
      assert.equal(await page.locator('#terminal-search-form').isVisible(),true);
      await page.locator('#terminal-token-query').fill('PLITE');
      await page.locator('#terminal-search-form button').click();
      assert.equal(await page.locator('#explore-section').isVisible(),true);
      assert.equal(await page.locator('#market-filter').inputValue(),'PLITE');
      await page.locator('#market-filter').fill('');
    }
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
    assert.equal(await page.locator('[data-trade-jump="buy"]').isVisible(),true,'Buy shortcut visible on market');
    assert.equal(await page.locator('[data-trade-jump="sell"]').isVisible(),true,'Sell shortcut visible on market');
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
    // Keyboard inspection is deterministic across the new compact mobile viewport:
    // hover at a fixed pixel can be over a noninteractive chart gutter.
    await svg.focus();
    await svg.press('Home');
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
