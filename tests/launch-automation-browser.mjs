import assert from 'node:assert/strict';

export async function verifyLaunchAutomationBrowser(browser,base) {
 for(const width of [390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'liquidity.html',{waitUntil:'networkidle'});
  await page.locator('#plan-coin-amount').fill('0.001');
  await page.locator('#plan-review').click();
  const link=page.locator('#plan-auto-launch');
  assert.equal(await link.count(),1,'positive first buy offers an opt-in creator link');
  const url=new URL(await link.getAttribute('href'));
  assert.equal(url.searchParams.get('liquidityChain'),'base');
  assert.equal(url.searchParams.get('liquidityBuy'),'0.001');
  await link.click();
  await page.waitForFunction(()=>document.documentElement.dataset.walletAppReady==='ready');
  assert.equal(await page.locator('#auto-liquidity-handoff').isVisible(),true);
  assert.equal(await page.locator('#auto-liquidity-status').textContent(),
    'Not active. Choose Use planned buy amount to opt in. No funds move from this page.');
  assert.equal(await page.locator('#initial-buy-dialog').isVisible(),false,'no transaction dialog on page load');
  await page.locator('#auto-liquidity-apply').click();
  assert.match(await page.locator('#auto-liquidity-status').textContent(),/Opted in to an amount of 0.001 ETH/);
  // Simulate the exact reviewed dialog-open state, no wallet/provider/network.
  await page.evaluate(()=>document.querySelector('#initial-buy-dialog').showModal());
  await page.waitForFunction(()=>document.querySelector('#initial-buy-eth').value==='0.001');
  assert.match(await page.locator('#auto-liquidity-status').textContent(),/separate wallet approvals/);
  await page.locator('#initial-buy-dialog').evaluate(dialog=>dialog.close());
  await page.locator('#auto-liquidity-skip').click();
  assert.match(await page.locator('#auto-liquidity-status').textContent(),/Skipped/);
  await page.goto(base+'?page=create&liquidityChain=solana&liquidityBuy=0.005',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.documentElement.dataset.walletAppReady==='ready');
  assert.equal(await page.locator('#chain').inputValue(),'solana');
  await page.locator('#auto-liquidity-apply').click();
  assert.match(await page.locator('#auto-liquidity-status').textContent(),/separate.*purchase|draft.*purchase/);
  assert.equal(await page.locator('#initial-buy-dialog').isVisible(),false,'Solana launch is not auto-signed');
  await page.goto(base+'?page=create&liquidityChain=base&liquidityBuy=1.1',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.documentElement.dataset.walletAppReady==='ready');
  assert.equal(await page.locator('#auto-liquidity-handoff').isVisible(),false,'unbounded URL cannot arm funding');
  assert.deepEqual(errors,[],'no JavaScript error on opt-in handoff at '+width+'px');
  await context.close();
  console.log('PASS launch auto-handoff '+width+'px: opt-in, exact amount, cancel, cross-chain setup, no wallet requests or background funding');
 }
}
