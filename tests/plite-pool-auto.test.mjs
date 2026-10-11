import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('official PLITE/WETH pair gets read-only, fail-closed reserve matching',async()=>{
 const [html,js,info]=await Promise.all(['liquidity.html','plite-pool-auto.js','web/plite-info.json'].map(p=>readFile(p,'utf8')));
 const token=JSON.parse(info);
 for(const key of ['pool-auto-match','pool-auto-refresh','pool-auto-source','pool-auto-fill','pool-auto-result','pool-auto-status'])assert.ok(html.includes('id="'+key+'"'),key);
 assert.ok(html.includes('<script defer src="./plite-pool-auto.js"></script>'));
 for(const a of [token.token,token.dexLiquidity.quoteTokenAddress,token.dexLiquidity.pair]){
  assert.ok(js.toLowerCase().includes(a.toLowerCase()),'canonical on-chain identity '+a);
 }
 assert.match(js,/https:\/\/base-rpc\.publicnode\.com/);
 assert.match(js,/https:\/\/mainnet\.base\.org/);
 assert.match(js,/eth_chainId/);
 assert.match(js,/eth_blockNumber/);
 assert.match(js,/eth_call/);
 assert.match(js,/0x2105/);
 assert.match(js,/0x0dfe1681/);
 assert.match(js,/0xd21220a7/);
 assert.match(js,/0xc45a0155/);
 assert.match(js,/0x0902f1ac/);
 assert.match(js,/canonical Base Uniswap V2 factory/);
 assert.match(js,/FRESH_MS=45_000/);
 assert.match(js,/Math.*ceil|Ceil to avoid quoting a zero side/);
 assert.match(js,/catch\(e\)/);
 assert.match(js,/production\)void refresh\(\)/);
 for(const danger of [/eth_sendTransaction/,/signTransaction/,/sendTransaction/,/signMessage/,/window\.ethereum/,/solana\.connect/,/localStorage/,/sessionStorage/,/\.click\(\)/,/\.submit\(\)/,/approve\(/,/addLiquidity\(/]){
  assert.doesNotMatch(js,danger,'Read-only pool matcher must never introduce signer/allowance/transfer code');
 }
});
test('production Pages build, browser fixture, and live parity monitor include matcher',async()=>{
 const [build,pages,health]=await Promise.all(['scripts/build.mjs','tests/pages.mjs','scripts/verify-public-site.mjs'].map(p=>readFile(p,'utf8')));
 for(const text of [build,pages,health])assert.ok(text.includes("'plite-pool-auto.js'"));
 assert.match(pages,/verifyPlitePoolAutoBrowser/);
 assert.match(health,/Verified PLITE\/WETH auto-matching is not live/);
});
