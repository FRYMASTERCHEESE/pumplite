import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load=filename=>readFile(filename,'utf8');
test('SOL and Base ETH bounty page prevents public/funded claims and asks for no wallet action',async()=>{
  const html=await load('bounties.html');
  const script=await load('bounties.js');
  for(const s of ['value="solana"','value="base"','Save private draft','Funding is NOT active.','No money will be collected','id="bounty-list"','id="bounty-amount"'])
    assert.ok(html.includes(s),s);
  assert.match(script,/pumplite:bounty-drafts:v1/);
  assert.match(script,/decimals:9/);
  assert.match(script,/decimals:18/);
  assert.match(script,/PRIVATE \/ UNFUNDED/);
  assert.doesNotMatch(script,/sendTransaction|signTransaction|sendRawTransaction|eth_sendTransaction|eth_requestAccounts|privateKey|secretKey/);
  assert.doesNotMatch(html,/<script[^>]*src="https?:/i);
});

test('live video implements real WHIP/WHEP browser session without exposing publisher key in shared URL',async()=>{
  const html=await load('live.html'),script=await load('live.js');
  for(const text of ['type="password"','id="whip-url"','id="whep-url"','id="watch-url"','id="start-live"','id="stop-live"','id="start-watch"','id="stop-watch"','Cloudflare Stream'])
    assert.ok(html.includes(text),text);
  for(const text of ['RTCPeerConnection','getUserMedia','addTransceiver','createOffer','setLocalDescription','setRemoteDescription',"method:'DELETE'",'webRTC/'])
    assert.ok(script.includes(text),text);
  assert.match(script,/cloudflarestream\\\.com/);
  assert.match(script,/share\.searchParams\.set\('watch',whep\)/);
  assert.doesNotMatch(script,/localStorage|sessionStorage|fetch\('https:\/\/api\.cloudflare\.com|console\.log\(|navigator\.sendBeacon/);
  assert.doesNotMatch(script,/sendTransaction|signTransaction|eth_sendTransaction|privateKey|seedPhrase/);
});

test('community live page gets scoped camera/network permissions without weakening the trading app',async()=>{
  const headers=await load('_headers');
  assert.ok(headers.includes('Permissions-Policy: camera=(), microphone=()'), 'main wallet keeps cameras disabled');
  assert.ok(headers.includes('/live.html'),'scoped live exception');
  assert.ok(headers.includes('Permissions-Policy: camera=(self), microphone=(self)'));
  assert.ok(headers.includes('https://*.cloudflarestream.com'));
  const nav=await load('pumplite-app.js');
  assert.ok(nav.includes("'./bounties.html'")&&nav.includes("'./live.html'"),'both pages linked in main app');
});

test('production Pages build and audit include new community routes',async()=>{
  const build=await load('scripts/build.mjs'), audit=await load('scripts/verify-public-site.mjs');
  for(const path of ['bounties.html','bounties.js','live.html','live.js','community.css']){
    assert.ok(build.includes("'"+path+"'"),'missing export '+path);
    assert.ok(audit.includes("'"+path+"'"),'missing deployed asset parity '+path);
  }
});
