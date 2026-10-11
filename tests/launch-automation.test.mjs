import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('automatic creator handoff is explicitly opted in, amount bounded and never signs or transmits',async()=>{
 const [js,html,planner,css]=await Promise.all(['launch-automation.js','index.html','liquidity.js','pumplite-app.css'].map(f=>readFile(f,'utf8')));
 for(const value of ['auto-liquidity-handoff','auto-liquidity-apply','auto-liquidity-skip','auto-liquidity-status'])assert.ok(html.includes(value),value);
 assert.match(css,/auto-liquidity-handoff/);
 assert.match(planner,/Continue with automatic launch setup/);
 assert.match(planner,/liquidityChain/);
 assert.match(planner,/liquidityBuy/);
 assert.match(js,/search\.get\('page'\)!=='create'/);
 assert.match(js,/amount|raw/);
 assert.match(js,/10n\*\*BigInt\(decimals\)/);
 assert.match(js,/accepted=true/);
 assert.match(js,/accepted=false/);
 assert.match(js,/new MutationObserver\(fillBase\)/);
 assert.match(js,/new MutationObserver\(fillSolanaDraft\)/);
 assert.match(js,/walletAppReady==='ready'/);
 assert.match(js,/marketPrepared=true/);
 for(const forbidden of [/fetch\s*\(/,/localStorage|sessionStorage/,/signTransaction|sendTransaction|signMessage|eth_sendTransaction|sendRawTransaction/,/requestAccounts|wallet\.connect|window\.ethereum/,/setInterval|setTimeout/,/\.click\s*\(/,/navigator\.clipboard/,/\.submit\s*\(/,/\.requestSubmit\s*\(/]){
   assert.doesNotMatch(js,forbidden,'No wallet/web transaction or background execution capability');
 }
 assert.match(js,/No buy has been sent/);
 assert.match(js,/No funds move/);
});

test('Pages export and live parity audit include handoff script; token identities and fees remain unchanged',async()=>{
 const [build,pages,verify]=await Promise.all(['scripts/build.mjs','tests/pages.mjs','scripts/verify-public-site.mjs'].map(f=>readFile(f,'utf8')));
 for(const s of [build,pages,verify])assert.ok(s.includes("'launch-automation.js'"),'must ship exact reviewed handoff');
 assert.match(verify,/Production creator opt-in handoff missing/);
 const html=await readFile('index.html','utf8');
 assert.match(html,/0%<\/b><small>PumpLite creation fee/);
 assert.match(html,/src="\.\/launch-automation\.js"/);
});
