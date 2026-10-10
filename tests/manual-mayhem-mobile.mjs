
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
const root=resolve('.');const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'};
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');let path=url.pathname.replace(/^\/pumplite\//,'');if(!path)path='index.html';const file=resolve(root,path);if(!file.startsWith(root+sep)||(!['index.html','config.json'].includes(path)&&!path.startsWith('assets/')))throw Error('blocked');res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(await readFile(file));}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/pumplite/';const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const pub={toBase58:()=> 'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct',equals:other=>other?.toBase58?.()==='BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'};window.phantom={solana:{publicKey:pub,on(){},removeListener(){},connect:async()=>({publicKey:pub}),signTransaction(){throw Error('Forbidden test transaction')},signMessage(){throw Error('Forbidden test signing')}}}});
 await page.route('**/*',async route=>{
  const url=route.request().url();if(url.startsWith(base))return route.continue();
  if(url.includes('/mayhem/capabilities'))return route.fulfill({json:{version:1,enabled:true,mode:'manual',controller:'9oAX1zbsCbAEr2uQnNDKL8QduVhBAsCU6eVBptaAffjG'}});
  let q;try{q=route.request().postDataJSON()}catch{}
  if(q?.method==='getGenesisHash')return route.fulfill({json:{jsonrpc:'2.0',id:q.id,result:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'}});
  if(url.includes('/launch/activated/'))return route.fulfill({json:{schemaVersion:1,programId:'3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku',genesisHash:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',slot:1,markets:[],next:null}});
  return route.fulfill({status:503,body:'Unavailable in offline test'});
 });
 await page.goto(base+'#solana',{waitUntil:'networkidle'});
 await page.locator('#connect').click();await page.waitForTimeout(300);if((await page.locator('#connect').textContent()).includes('Approve'))await page.locator('#connect').click();
 await page.locator('#show-create:visible, [data-page=create]:visible').click();await page.locator('#name').fill('Offline Mayhem');await page.locator('#symbol').fill('TEST');
 await page.locator('#solana-mayhem-manual').click();await page.locator('#create').click();await page.locator('#initial-buy-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#initial-buy-eth').isEnabled(),true);await page.locator('#initial-buy-eth').fill('0.0001');
 assert.equal(await page.locator('.initial-buy-amount strong').textContent(),'SOL');assert.equal(await page.locator('#initial-buy-submit').textContent(),'Create Manual Mayhem coin');
 assert.match(await page.locator('#initial-buy-dialog .create-fee-note small').textContent(),/requires a Phantom-approved activation buy/);
 assert.doesNotMatch(await page.locator('#initial-buy-dialog').textContent(),/no buyer activation is required/i);
 await page.locator('#initial-buy-close').click();await page.locator('#solana-mayhem-off').click();await page.locator('#create').click();
 assert.equal(await page.locator('#initial-buy-eth').isDisabled(),true);assert.equal(await page.locator('.initial-buy-amount').isHidden(),true);
 assert.match(await page.locator('#initial-buy-dialog .create-fee-note small').textContent(),/No buyer activation is required/);
 assert.deepEqual(errors,[]);console.log('PASS mobile Pages: Manual editable/one SOL label/accurate copy; normal direct-create; no signing or transactions');
 await context.close();
}finally{await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections()})}
