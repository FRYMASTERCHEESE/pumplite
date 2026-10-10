import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Auto Setup is explicit and defaults to preparing IPFS on a deliberate Create click',async()=>{
 const [html,js,css]=await Promise.all(['index.html','web/app.js','web/styles.css'].map(f=>readFile(f,'utf8')));
 assert.match(html,/id="auto-prepare-metadata" checked/);
 assert.match(html,/final transaction review/);
 assert.match(html,/Wallet authorizations and network\/account costs are still required/);
 assert.ok(css.includes('#auto-prepare-metadata'));
 const creator=js.slice(js.indexOf("$('create-form').addEventListener('submit'"),js.indexOf("$('initial-buy-form').addEventListener('submit'"));
 assert.match(creator,/if \(\$\('auto-prepare-metadata'\)\.checked && !\$\('uri'\)\.value\.trim\(\)\)/);
 assert.match(creator,/await publishTokenMetadata\(\)/);
 assert.ok(creator.indexOf('await publishTokenMetadata()') < creator.indexOf('creationData();'), 'publish before finished creation preflight');
 assert.match(creator,/Auto setup needs a token image/);
 assert.match(creator,/creationData\(\)/);
 assert.match(creator,/\$\('initial-buy-dialog'\)\.showModal\(\)/);
 assert.doesNotMatch(creator,/adapter\.create\(|sendTransaction|signTransaction|setInterval|setTimeout/);
});

test('Auto Setup reuses existing authorized metadata handler; only final wallet-confirmed flow can create',async()=>{
 const js=await readFile('web/app.js','utf8');
 assert.match(js,/async function publishTokenMetadata\(\)/);
 assert.match(js,/\$\('publish-metadata'\)\.addEventListener\('click', \(\) => action\(publishTokenMetadata\)\)/);
 const publisher=js.slice(js.indexOf('async function publishTokenMetadata()'),js.indexOf('const HOME_PAGE_TARGETS'));
 assert.match(publisher,/signMetadataMessage/);
 assert.match(publisher,/uploadTokenMetadata/);
 assert.match(publisher,/publishedDraft = draftIdentity\(\)/);
 assert.match(publisher,/\$\('uri'\)\.value = result\.metadata\.uri/);
 assert.doesNotMatch(publisher,/adapter\.create\(|adapter\.trade\(|eth_sendTransaction/);
 const creation=js.slice(js.indexOf("$('initial-buy-form').addEventListener('submit'"),js.indexOf("for (const id of ['side','amount','slippage'])"));
 assert.match(creation,/requireWrite\(\)/);
 assert.match(creation,/await adapter\.create\(/);
 assert.match(creation,/manualSolana/);
 assert.match(creation,/initialBuy !== 0n/);
 assert.match(creation,/Your token was created, but the optional first buy did not complete/);
 assert.doesNotMatch(publisher,/localStorage|sessionStorage|privateKey|secretKey/);
});
