import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('new coin and PLITE funding stay separate with explicit wallet consent',async()=>{
 const [page,app,script]=await Promise.all(['liquidity.html','index.html','liquidity.js'].map(f=>readFile(f,'utf8')));
 for(const marker of ['Nothing funds itself when a coin is created.','0% creation fee','PLITE + WETH','id="plan-chain"','id="plan-coin-amount"','id="plan-plite"','id="plan-weth"','id="plan-review"','Review plan — no transaction','impermanent loss']){
   assert.ok(page.includes(marker),marker);
 }
 assert.match(page,/approve any token allowance|approve Uniswap|Review your opt-in/i);
 assert.match(app,/id="launch-liquidity-disclosure"/);
 assert.match(app,/PLITE's separate Uniswap V2 PLITE\/WETH pool is not funded by coin creation fees/);
 assert.match(script,/Solana Classic: creating a token does not buy it/);
 assert.match(script,/optional first ETH buy/);
 assert.match(script,/matched|requires both PLITE and WETH/);
 for(const danger of [/fetch\s*\(/,/sendTransaction/,/signTransaction/,/eth_sendTransaction/,/wallet\.connect/,/localStorage/,/sessionStorage/,/setInterval/,/setTimeout/,/getAccounts/,/window\.ethereum/]){
   assert.doesNotMatch(script,danger,'planner must never have a write/signer/network dependency');
 }
 assert.match(script,/textContent=msg/);
 assert.match(script,/BigInt/);
});

test('PLITE pool and token identity agree exactly with reviewed public record',async()=>{
 const [html,info]=await Promise.all([readFile('liquidity.html','utf8'),readFile('web/plite-info.json','utf8')]);
 const json=JSON.parse(info),pair=json.dexLiquidity;
 assert.equal(json.chainId,8453);
 assert.equal(pair.protocol,'Uniswap V2');
 assert.equal(pair.quoteTokenAddress.toLowerCase(),'0x4200000000000000000000000000000000000006');
 for(const k of [json.token,pair.quoteTokenAddress,pair.pair,pair.uniswap])assert.ok(html.includes(k),k);
 assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
});

test('liquidity guidance reaches GitHub Pages without modifying chain assets',async()=>{
 const [build,pages,audit,app]=await Promise.all(['scripts/build.mjs','tests/pages.mjs','scripts/verify-public-site.mjs','index.html'].map(f=>readFile(f,'utf8')));
 for(const file of ['liquidity.html','liquidity.js']){
  assert.ok(build.includes("'"+file+"'"),'Pages build must export '+file);
  assert.ok(pages.includes("'"+file+"'"),'Pages browser fixture must test '+file);
  assert.ok(audit.includes("'"+file+"'"),'Live public verification must audit '+file);
 }
 assert.ok(app.includes('href="./liquidity.html"'));
});