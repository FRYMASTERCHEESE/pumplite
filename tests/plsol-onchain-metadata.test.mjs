import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('official PLSOL website identifies immutable existing on-chain metadata', async()=>{
 const [html,readme,registry] = await Promise.all([
  readFile('plsol.html','utf8'), readFile('README.md','utf8'),readFile('solana-token-list.json','utf8')
 ]);
 const mint='EUKhN8eP97NjRHzxwRT5pdgLg7BX5KRTBhJYa2hMu9ma';
 const meta='bafkreif43vkuy2xgkcilgzm63nc3hqo6nlvvppgzyr4almygxue6zimkle';
 const image='bafybeif536vvjrwpbyvtxwx432kyqxagji2tafmeetev57e5x2rckjyd5e';
 assert.ok(html.includes(mint)&&readme.includes(mint),'mint identity unchanged');
 assert.ok(html.includes(meta)&&readme.includes(meta),'existing immutable JSON URI is traceable');
 assert.ok(html.includes(image)&&readme.includes(image),'existing IPFS logo CID is traceable');
 assert.ok(html.includes('immutable')&&html.includes('DEX pair'),'Phantom price and metadata status explained');
 assert.ok(!readme.includes('Metaplex wallet metadata is **not published yet**'),'no outdated unpublished claim');
 const tokens=JSON.parse(registry).tokens;
 assert.equal(tokens[0].address,mint);
 assert.equal(tokens[0].symbol,'PLSOL');
});
