// Real browser execution of the staged instruction builders. No RPC, wallets or transactions.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {once} from 'node:events';
const built=await build({stdin:{contents:`
import {encodeV6Launch} from './web/base-v6-launch.js';
import abis from './web/generated/base-v6-abi.json';
import {Interface} from 'ethers';
import {PublicKey} from '@solana/web3.js';
import {createInstructions,tradeInstructions,mayhemInstruction} from './web/solana-v6-instructions.js';
window.v6={encodeV6Launch,abis,Interface,PublicKey,createInstructions,tradeInstructions,mayhemInstruction};`,resolveDir:process.cwd()},
  bundle:true,write:false,format:'esm',platform:'browser',target:['es2022'],define:{'process.env.NODE_ENV':'"production"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');
  res.end(req.url==='/fixture.js'?built.outputFiles[0].contents:'<!doctype html><meta name="viewport" content="width=device-width"><title>V6 local instruction fixture</title><script type="module" src="/fixture.js"></script>');});
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await chromium.launch({headless:true});
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){external.push(route.request().url());return route.abort();}return route.continue();});
    await page.addInitScript(()=>{window.ethereum={request(){throw Error('Wallet must not be accessed');}};window.solana={connect(){throw Error('Wallet must not be accessed');}};});
    await page.goto(origin);await page.waitForFunction(()=>Boolean(window.v6));
    const result=await page.evaluate(async()=>{
      const {encodeV6Launch,Interface,abis,PublicKey,createInstructions,tradeInstructions,mayhemInstruction}=window.v6;
      const key=n=>new PublicKey(new Uint8Array(32).fill(n)),owner=key(1),programId=key(2);
      const modes=[];
      for(const launchMode of [0,1,2]) {
        const data=encodeV6Launch({name:'Browser V6',symbol:'V6',uri:'',initialSupply:10n**27n,maxSupply:10n**27n,mintable:false,launchMode});
        const decoded=new Interface(abis.LaunchFactoryV6).decodeFunctionData('createMarketV6',data)[0];
        const sol=await createInstructions({owner,programId,nonce:new Uint8Array(8),name:'Browser V6',symbol:'V6',uri:'',launchMode});
        modes.push([decoded.launchMode.toString(),sol.instructions[0].data.at(-1),sol.market.toBase58()]);
      }
      const amount=(1n<<63n)+17n,min=(1n<<53n)+3n;
      const [trade]=await tradeInstructions({owner,programId,mint:key(3),market:key(4),treasury:key(5),side:'sell',amount,min,deadline:1000180n});
      const fund=await mayhemInstruction({action:'fund_mayhem',owner,programId,market:key(4),amount:1000000n});
      let rejected=0;
      for(const launchMode of [-1,3,'1',null]){try{await createInstructions({owner,programId,nonce:new Uint8Array(8),name:'V6',symbol:'V6',uri:'',launchMode});}catch{rejected++;}}
      return {modes,amount:trade.data.readBigUInt64LE(8).toString(),min:trade.data.readBigUInt64LE(16).toString(),fund:fund.data.readBigUInt64LE(8).toString(),rejected};
    });
    assert.deepEqual(result.modes.map(m=>m.slice(0,2)),[['0',0],['1',1],['2',2]]);
    assert.equal(new Set(result.modes.map(m=>m[2])).size,1,'Mode must be data, not a different market identity for the same nonce');
    assert.equal(result.amount,((1n<<63n)+17n).toString());assert.equal(result.min,((1n<<53n)+3n).toString());
    assert.equal(result.fund,'1000000');assert.equal(result.rejected,4);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(`PASS V6 browser ${width}px: three exact chain modes, u64 precision, funding calldata, invalid modes, no wallet/RPC calls`);
    await page.close();
  }
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
