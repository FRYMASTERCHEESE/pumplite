import assert from 'node:assert/strict';

export async function verifyCommunityBrowser(browser,base) {
  for (const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'bounties.html',{waitUntil:'networkidle'});
    assert.equal(await page.locator('#bounty-count').textContent(),'0');
    await page.locator('#bounty-amount').fill('0.125');
    await page.locator('#bounty-title').fill('Review an original coin icon');
    await page.locator('#bounty-description').fill('Submit your own icon illustration, sources, and a suitable high-resolution PNG file.');
    const d=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    await page.locator('#bounty-deadline').fill(d);
    await page.locator('#bounty-form button[type=submit]').click();
    assert.match(await page.locator('#bounty-status').textContent(),/Private draft saved/);
    assert.equal(await page.locator('#bounty-count').textContent(),'1');
    assert.match(await page.locator('.draft small').first().textContent(),/0.125 SOL.*PRIVATE \/ UNFUNDED/);
    await page.locator('#bounty-network').selectOption('base');
    await page.locator('#bounty-amount').fill('0.001000000000000001');
    await page.locator('#bounty-title').fill('Base ETH acceptance criteria');
    await page.locator('#bounty-description').fill('Submit a verifiable document. Bounty stays a private draft and is not funded.');
    await page.locator('#bounty-deadline').fill(d);
    await page.locator('#bounty-form button[type=submit]').click();
    assert.equal(await page.locator('#bounty-count').textContent(),'2');
    assert.match(await page.locator('.draft small').first().textContent(),/ETH.*PRIVATE \/ UNFUNDED/);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pumplite:bounty-drafts:v1')).length),2);
    await page.reload();
    assert.equal(await page.locator('#bounty-count').textContent(),'2','drafts persist on this device');
    await page.locator('.draft button').first().click();
    assert.equal(await page.locator('#bounty-count').textContent(),'1','Delete draft does not spend');
    await page.goto(base+'live.html',{waitUntil:'networkidle'});
    assert.match(await page.locator('#broadcast-state').textContent(),/Offline/);
    assert.equal(await page.locator('#stop-live').isDisabled(),true);
    const publicUrl='https://customer-test.cloudflarestream.com/0123456789abcdef0123456789abcdef/webRTC/play';
    await page.locator('#whip-url').fill('https://other.com/bad/webRTC/publish');
    await page.locator('#whep-url').fill(publicUrl);
    await page.locator('#start-live').click();
    assert.match(await page.locator('#broadcast-error').textContent(),/official Cloudflare Stream/i);
    assert.match(await page.locator('#broadcast-state').textContent(),/Offline/);
    await page.goto(base+'live.html?watch='+encodeURIComponent(publicUrl));
    assert.equal(await page.locator('#watch-url').inputValue(),publicUrl);
    await page.goto(base+'live.html?watch='+encodeURIComponent('https://evil.example/path'));
    assert.match(await page.locator('#watch-state').textContent(),/Invalid public viewer link/);
    assert.deepEqual(errors,[],'bounty and live pages must have no JS runtime errors at '+width+'px');
    await context.close();
    console.log('PASS bounty/live '+width+'px: SOL+ETH private drafts, persistence, no unverified funding, strict WHIP/WHEP URL checks');
  }
}
