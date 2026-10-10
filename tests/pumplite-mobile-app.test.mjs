import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load=async name => readFile(name,'utf8');

test('mobile app includes five working navigation targets and single canonical PLITE claim',async()=>{
 const html=await load('index.html');
 for(const route of ['home','markets','create','portfolio','help'])
   assert.ok(html.includes('data-page="'+route+'"'),'missing mobile '+route);
 for(const marker of ['id="app-header-tools"','class="app-home-feed"',
                      'id="app-feed-content"','id="app-action-sheet"','id="app-sheet-items"',
                      'id="app-wallet-chip"','id="app-search"','class="app-coin-table-head"',
                      'href="./pumplite-app.css"','src="./pumplite-app.js"'])
   assert.ok(html.includes(marker),marker);
 assert.equal((html.match(/href="\.\/claim\.html"/g)||[]).length,1,
   'only one exact canonical PLITE claim anchor');
});

test('mobile shell uses existing markets and wallet UI without constructing trades',async()=>{
 const app=await load('pumplite-app.js');
 for(const marker of ['home-markets','markets','market-sort','market-filter',
                      'data-app-feed','data-app-sort','show-home','show-explore',
                      'show-create','show-portfolio','show-help','app-popover-layer'])
   assert.ok(app.includes(marker),'missing on-chain feature '+marker);
 assert.doesNotMatch(app,/signTransaction|sendTransaction|sendRawTransaction|eth_sendTransaction|secretKey|privateKey|seedPhrase/);
 assert.match(app,/Unavailable — no bounty payment\/escrow backend/);
 assert.match(app,/no broadcast infrastructure/);
 assert.match(app,/not connected yet/);
});

test('mobile visual app exposes real list and popup while preserving hidden routes',async()=>{
 const css=await load('pumplite-app.css');
 assert.match(css,/max-width:740px/);
 assert.match(css,/#home-overview\[hidden\]\{display:none!important\}/);
 for(const marker of ['.app-feed-tabs','.app-coin-filters','.app-coin-table-head',
                      '.app-action-sheet','.app-popover-backdrop','.bottom-nav button svg'])
   assert.ok(css.includes(marker),marker);
 assert.doesNotMatch(css,/fake.*chart|fake.*market|fabricated.*price/i);
});

test('build exports mobile files with a compressed entry budget',async()=>{
 const build=await load('scripts/build.mjs');
 for(const marker of ["'pumplite-app.js'","'pumplite-app.css'","appShellBytes","82_000"])
   assert.ok(build.includes(marker),marker);
});
