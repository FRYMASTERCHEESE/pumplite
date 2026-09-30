import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Interface, AbiCoder, keccak256, toUtf8Bytes, ZeroHash } from 'ethers';
import { OFFICIAL_BASE_FACTORY } from '../web/verification.js';
import { EAS_ADDRESS, PUMPLITE_REVIEW_SCHEMA_UID } from '../web/adapters/base-v2.js';

// Called against the production /pumplite/ export.
// All chain and owner-list data are synthetic; no wallet transaction is submitted.
export async function verifyBrowser(browser, base) {
 const abi=JSON.parse(await readFile('web/generated/base-v2-abi.json'));
 const f=new Interface(abi.LaunchFactoryV2),c=new Interface(abi.CurveMarketV2),t=new Interface(abi.LaunchTokenV2);
 const market='0x'+'1'.repeat(40),token='0x'+'2'.repeat(40),creator='0x'+'3'.repeat(40);
 const treasury='0x0de7fdcc798f7fac6b03b366c529133a9c60794d';
 const supply=10n**27n;
 const easUid='0x'+'4'.repeat(64);
 const reviewData=AbiCoder.defaultAbiCoder().encode(
  ['address','address','address','address','uint8','bytes32','uint64'],
  [
   market,
   token,
   creator,
   OFFICIAL_BASE_FACTORY,
   1,
   keccak256(toUtf8Bytes('ipfs://fixture')),
   1n
  ]
 );
 const eas=new Interface([
  'function getAttestation(bytes32 uid) view returns (tuple(bytes32 uid,bytes32 schema,uint64 time,uint64 expirationTime,uint64 revocationTime,bytes32 refUID,address recipient,address attester,bool revocable,bytes data) attestation)'
 ]);
 const entry={
  status:'verified',
  market,
  token,
  creator,
  name:'Fixture token',
  symbol:'FX',
  metadataURI:'ipfs://fixture',
  easUid,
  reviewedAt:'2026-01-01T00:00:00.000Z',
  note:'<img src=x onerror=alert(1)>'
 };
 for(const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:900}}), errors=[];
  let registry={version:1,base:{[market]:entry}}, registryDown=false,registered=true,rpcDown=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.ethereum={request(){throw Error('Real wallet calls prohibited');}};});
  await page.route('**/assets/verified-tokens.json',r=>r.fulfill(registryDown?{status:503,body:'Unavailable'}:{json:registry}));
  await page.route(/https:\/\/(?:mainnet\.base\.org|base-rpc\.publicnode\.com)\/?/,async r=>{
   if(rpcDown)return r.fulfill({status:503,body:'Unavailable'});
   const req=r.request().postDataJSON();let result;
   assert.ok(!Array.isArray(req));
   if(req.method==='eth_chainId')result='0x2105';
   else if(req.method==='eth_blockNumber')result='0x64';
   else if(req.method==='eth_getLogs')result=[];
   else if(req.method==='eth_call') {
    const tx=req.params[0],address=tx.to.toLowerCase();

    const values={
      marketCount:1n,
      markets:market,
      isMarket:registered,

      token,
      nativeReserve:0n,
      tokenReserve:supply,
      volume:0n,
      creator,
      treasury,
      metadataURI:'ipfs://fixture',
      initialSupply:supply,
      initialMayhem:false,
      manualMayhem:false,
      mayhemActive:false,
      launchedAt:1n,
      totalMarketSupport:0n,
      totalBurned:0n,
      mayhemController:treasury,

      name:'Fixture token',
      symbol:'FX',
      totalSupply:supply,
      maxSupply:supply,
      mintableAtLaunch:false,
      mintingLocked:true,
      totalMinted:supply,
      remainingMintAllowance:0n
    };

    const encodeSingleCall=(target,data)=>{
     const targetAddress=String(target).toLowerCase();
     const iface=
      targetAddress===OFFICIAL_BASE_FACTORY.toLowerCase()
       ? f
       : (
          targetAddress===market ||
          targetAddress==='0xa522a4ef81fd31daec390ab46a32d4886e1461c7'
         )
        ? c
        : targetAddress===token
         ? t
         : targetAddress===EAS_ADDRESS.toLowerCase()
          ? eas
          : null;

     assert.ok(iface,'Unexpected target '+targetAddress);

     const call=
      iface.parseTransaction({
       data
      });

     if(targetAddress===EAS_ADDRESS.toLowerCase()){
      assert.equal(
       call.name,
       'getAttestation'
      );

      assert.equal(
       call.args[0],
       easUid
      );

      return eas.encodeFunctionResult(
       'getAttestation',
       [[
        easUid,
        PUMPLITE_REVIEW_SCHEMA_UID,
        1n,
        0n,
        0n,
        ZeroHash,
        token,
        treasury,
        true,
        reviewData
       ]]
      );
     }

     assert.ok(
      Object.hasOwn(values,call.name),
      'Unexpected V2 call '+call.name
     );

     return iface.encodeFunctionResult(
      call.name,
      [values[call.name]]
     );
    };

    const multicallAddress=
     '0xca11bde05977b3631167028862be2a173976ca11';

    if(address===multicallAddress){
     const multicall=
      new Interface([
       'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)'
      ]);

     const call=
      multicall.parseTransaction({
       data:tx.data
      });

     assert.equal(
      call.name,
      'aggregate3'
     );

     const rows=
      call.args[0].map(item=>{
       try {
        return [
         true,
         encodeSingleCall(
          item.target,
          item.callData
         )
        ];
       } catch(error) {
        if(item.allowFailure){
         return [false,'0x'];
        }
        throw error;
       }
      });

     result=
      multicall.encodeFunctionResult(
       'aggregate3',
       [rows]
      );
    } else {
     result=
      encodeSingleCall(
       address,
       tx.data
      );
    }
   } else throw Error('Forbidden/unexpected RPC '+req.method);
   return r.fulfill({json:{jsonrpc:'2.0',id:req.id,result}});
  });
  await page.goto(base,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#chain')?.value==='base');
  assert.equal(await page.locator('#chain').inputValue(),'base');
  await page.locator('#show-explore').click();
  assert.equal(await page.locator('#explore-section').isVisible(),true);
  assert.equal(await page.locator('#create-section').isVisible(),false);
  await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelectorAll('.market-row').length===1);
  assert.equal(await page.locator('.market-row .badge').count(),2);
  await page.locator('#verified-only').check();await page.waitForFunction(()=>!document.querySelector('#verified-only').disabled);
  assert.equal(await page.locator('.market-row').count(),1);
  registry={version:1,base:{}};await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.market-row').count(),0,'Revocation removes verified-only results');
  await page.locator('#verified-only').uncheck();await page.waitForFunction(()=>!document.querySelector('#verified-only').disabled);
  assert.equal(await page.locator('.market-row .verified').count(),0);
  assert.deepEqual(
   await page.locator('.market-row .badge').allTextContents(),
   ['Created on PumpLite','Pending review']
  );
  registry={version:1,base:{[market]:entry}};
  await page.locator('.market-row').click();await page.waitForFunction(()=>document.querySelector('#verification-state').textContent.startsWith('Verified'));
  await page.waitForFunction(()=>document.querySelector('#price-chart-change')?.textContent==='No trades yet');
  assert.equal(
   await page.locator('#price-chart-change').textContent(),
   'No trades yet',
   'Empty on-chain Trade history must produce an honest empty chart'
  );
  assert.equal(await page.locator('[data-chart-range]').count(),6);
  assert.equal(
   await page.locator('[data-chart-range="LIVE"]').getAttribute('aria-pressed'),
   'true'
  );
  await page.locator('[data-chart-range="1D"]').click();
  assert.equal(
   await page.locator('[data-chart-range="1D"]').getAttribute('aria-pressed'),
   'true'
  );
  assert.equal(
   await page.locator('#price-chart-change').textContent(),
   'No trades yet',
   'Changing range must not invent price history'
  );
  assert.equal(await page.locator('#verification-details img').count(),0,'Notes rendered as inert text');
  assert.match(await page.locator('#verification-details').textContent(),/onerror/);
  assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
  registry={version:1,base:{[market]:{...entry,creator:token}}};
  await page.locator('#refresh-market').click();await page.waitForFunction(()=>!document.querySelector('#refresh-market').disabled);
  assert.equal(await page.locator('#market-badges .verified').count(),0);
  registryDown=true;await page.locator('#refresh-market').click();await page.waitForFunction(()=>!document.querySelector('#refresh-market').disabled);
  assert.deepEqual(
   await page.locator('#market-badges .badge').allTextContents(),
   ['Created on PumpLite','Pending review'],
   'Review-list failure preserves provenance and falls back to Pending review'
  );
  rpcDown=true;await page.locator('#refresh-market').click();await page.waitForFunction(()=>!document.querySelector('#refresh-market').disabled);
  assert.equal(await page.locator('#market-badges .badge').count(),0,'RPC failure clears old badges');
  rpcDown=false;registryDown=false;registered=false;
  await page.locator('#refresh-market').click();await page.waitForFunction(()=>!document.querySelector('#refresh-market').disabled);
  assert.equal(await page.locator('#market-badges .badge').count(),0,'Non-factory market never badged');
  await page.goto(base+'#solana/'+market,{waitUntil:'networkidle'});
  assert.equal(await page.locator('#market-badges .badge').count(),0);
  assert.equal(await page.locator('#create').isDisabled(),true);
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('#show-create').click();
  assert.equal(await page.locator('#create-section').isVisible(),true);
  await page.locator('#name').fill('Social token');await page.locator('#symbol').fill('SOC');
  await page.locator('#description').fill('Synthetic local project');
  await page.locator('#website').fill('https://example.com');await page.locator('#twitter').fill('https://x.com/example');
  await page.locator('#telegram').fill('https://t.me/example');await page.locator('#discord').fill('https://discord.gg/example');
  await page.locator('#banner-uri').fill('ipfs://banner');
  await page.locator('#advanced-metadata summary').click();
  assert.equal(await page.locator('#download-metadata').textContent(),'Copy metadata JSON');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => {} }
    });
  });
  await page.locator('#download-metadata').click();
  await page.waitForFunction(() =>
    document.querySelector('#status-text').textContent.includes('Metadata JSON copied to clipboard')
  );
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);return canvas.toDataURL().split(',')[1];});
  await page.locator('#metadata-image').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>document.querySelector('#media-status').textContent.startsWith('Local preview ready'));
  assert.equal(await page.locator('#image-preview').isVisible(),true);
  assert.equal(await page.locator('#create').isDisabled(),false,'Base create stays actionable and requests wallet access only after a user click');
  assert.equal(await page.locator('#publish-metadata').isDisabled(),false,'Metadata publish stays actionable after an image is selected');
  assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS redesigned Pages '+width+'px: Base V2 provenance, manual reviews, revoke/filter/mismatch/RPC failures, safe notes, metadata links/banner copy, local media preview, Solana locked');
  await page.close();
 }
}
