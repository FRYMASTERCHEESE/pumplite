import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('V2 checkbox accurately describes actual deployed contract mode (not autonomous V3)',async()=>{
 const [html,script,market,adapter,app,config]=await Promise.all([
 'index.html','base-mayhem-explainer.js','contracts/base/v2/CurveMarketV2.sol',
 'web/adapters/base-v2.js','web/app.js','config.json'
 ].map(p=>readFile(p,'utf8')));
 const live=JSON.parse(config);
 assert.equal(live.base.chainId,8453);
 assert.equal(live.base.contractVersion,2,'do not pretend V3 is deployed');
 assert.ok(html.includes('id="v2-initial-mayhem"'));
 assert.match(html,/Mayhem reserve support for its first 24 hours/);
 assert.match(html,/0\.75% of each real buy or sell amount is retained as market backing/);
 assert.match(html,/V3 Mayhem Auto requires a separate V3 deployment/);
 assert.match(script,/SELECTED for the NEXT new Base V2 coin/);
 assert.match(script,/NOT SELECTED/);
 assert.match(script,/It becomes active only if that transaction confirms/);
 assert.match(script,/Existing coins are unchanged/);
 assert.match(market,/INITIAL_MAYHEM_DURATION = 24 hours/);
 assert.match(market,/initialMayhem &&/);
 assert.match(market,/return manualMayhem;/);
 assert.match(market,/MAYHEM_SUPPORT_BPS = 75/);
 assert.match(market,/function setMayhem\(bool enabled\) external onlyMayhemController/);
 assert.match(adapter,/initialMayhem: initialMayhem === true/);
 assert.match(app,/data\.initialMayhem\s*=\s*\$\('v2-initial-mayhem'\)\.checked/);
 for(const forbidden of [/fetch\s*\(/,/eth_sendTransaction/,/signTransaction/,/sendTransaction/,/\.click\(/,/\.submit\(/,/\.requestSubmit\(/,/setInterval\(/,/localStorage/,/sessionStorage/]){
  assert.doesNotMatch(script,forbidden,'explanatory checkbox must never transact or store data');
 }
});

test('Mayhem activation explanation is shipped and included in public site verification',async()=>{
 const [build,pages,health,monitor,html]=await Promise.all([
 'scripts/build.mjs','tests/pages.mjs','.github/workflows/public-site-health.yml',
 'scripts/verify-public-site.mjs','index.html'
 ].map(p=>readFile(p,'utf8')));
 assert.match(html,/src="\.\/base-mayhem-explainer\.js"/);
 for(const s of [build,pages,health,monitor])assert.ok(s.includes('base-mayhem-explainer.js'));
 assert.match(monitor,/Live V2 checkbox on-chain activation explanation missing/);
});
