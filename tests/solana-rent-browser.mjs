import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {tinyMarketAddress} from '../web/solana-tiny-instructions.js';
export async function verifySolanaRentBrowser(browser,base){
 const program=new PublicKey('3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku');let mint,market;
 for(let i=1;i<255;i++){try{mint=new PublicKey(new Uint8Array(32).fill(i));market=tinyMarketAddress(mint,program);break;}catch{}}
 const amount=1000000000000000n*1995000n/(30000000000n+1995000n);
 const mintData=Buffer.alloc(82);mintData[0]=1;market.toBuffer().copy(mintData,4);mintData.writeBigUInt64LE(amount,36);mintData[44]=6;mintData[45]=1;
 const str=s=>{const b=Buffer.from(s),n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b]);};
 const md=Buffer.concat([Buffer.from([4]),Buffer.alloc(32,7),mint.toBuffer(),str('Rent test'),str('RENT'),str('https://example.invalid/metadata.json')]);
 const account=(owner,data,lamports=2000000)=>({owner,data:[data.toString('base64'),'base64'],lamports,executable:false,rentEpoch:0});
 for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{if(route.request().url().startsWith(base))return route.continue();const q=route.request().postDataJSON();let result;
 if(q?.method==='getGenesisHash')result='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
 else if(q?.method==='getMultipleAccounts')result={context:{slot:10},value:[account('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',mintData),account('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',md),account('11111111111111111111111111111111',Buffer.alloc(0),1995000)]};
 else if(q?.method==='getMinimumBalanceForRentExemption')result=650240;
 else return route.fulfill({status:503,body:'Blocked synthetic request'});
 return route.fulfill({contentType:'application/json',body:JSON.stringify({jsonrpc:'2.0',id:q.id,result})});});
 await page.goto(base+'#solana/'+mint.toBase58(),{waitUntil:'networkidle'});
 await page.locator('#amount').fill((Number(amount)/1e6).toFixed(6));await page.locator('#get-quote').click();
 await page.waitForFunction(()=>document.querySelector('#solana-rent-panel').hidden===false);
 assert.match(await page.locator('#solana-rent-details').textContent(),/0.000650239 SOL/);
 assert.equal(await page.locator('#solana-rent-consent').isChecked(),false);
 await page.locator('#solana-rent-consent').check();await page.locator('#amount').fill('1');
 assert.equal(await page.locator('#solana-rent-panel').isHidden(),true);assert.equal(await page.locator('#solana-rent-consent').isChecked(),false);
 assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 await context.close();console.log('PASS Solana rent disclosure and consent reset '+width+'px');
 }
}
