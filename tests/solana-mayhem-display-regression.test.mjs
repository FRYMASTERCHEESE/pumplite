import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMayhemPanel, signedMayhemRequest} from '../web/mayhem-ui.js';
import {manualMayhemReady} from '../web/activation-recovery.js';
import {verificationStateText} from '../web/verification-ui.js';
import {tokenTrust} from '../web/verification.js';

function node(tag = 'section') {
  return {
    tag,
    children: [],
    classList: {add() {}},
    replaceChildren(...items) {this.children = items;},
    append(...items) {this.children.push(...items);},
    addEventListener() {}
  };
}

function flatten(root) {
  return [root, ...(root.children || []).flatMap(flatten)];
}

const creator='BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct';
const mint='FEofu2h5RY4yyuoZJKT4VhwWqJ78ScEy6WjoFCyQ1Xqe';

function launch(status,expiresAt=Date.now()+60000) {
  return {
    mode:'manual', status, creator, mint, authorized:true,
    canonicalActivation:true,
    activation:{mint}, hasActivity:true,
    expiresAt, pending:false,
    metrics:{organicVolume:null,agentVolume:0,totalVolume:null},
    actions:[]
  };
}

function render(view) {
  const prior=globalThis.document;
  const host=node();
  globalThis.document={createElement:node};
  try {
    renderMayhemPanel(host,view,{
      enabled:true,wallet:creator,onTrigger:async()=>{}
    });
    return host;
  } finally {
    globalThis.document=prior;
  }
}

test('ended and expired Manual Mayhem show historical metrics but never a trigger',()=>{
  for(const state of [
    launch('ended'),
    launch('active',Date.now()-1000),
    launch('paused')
  ]) {
    const host=render(state);
    const nodes=flatten(host);
    assert.equal(nodes.filter(n=>n.tag==='button').length,0);
    assert.equal(nodes.some(n=>String(n.textContent||'').includes('Mayhem Agent volume')),true);
    // A paused launch can still be recoverable; it must not be tradeable.
    if (state.status !== 'paused') {
      assert.equal(manualMayhemReady(state), false);
    }
  }
  const active=render(launch('active'));
  assert.equal(flatten(active).filter(n=>n.tag==='button').length,1);
});

test('non-active Manual Mayhem cannot initiate wallet signing or network sends',async()=>{
  for (const state of [launch('ended'),launch('paused'),launch('active',Date.now()-1000)]) {
    let calls=0;
    await assert.rejects(
      signedMayhemRequest(state,creator,async()=>{calls++;return 'signature';},async()=>{calls++;}),
      /Trigger is unavailable/
    );
    assert.equal(calls,0);
  }
});

test('Solana on-chain market identity and separate owner review are clearly distinguished',()=>{
  const solana={protocol:'tiny',id:mint,token:mint,creator,name:'Mayhem Monday',symbol:'MAYM'};
  const trust=tokenTrust('solana',{},solana,{version:1,base:{}});
  assert.equal(trust.verified,false);
  assert.equal(trust.created,false);
  const message=verificationStateText('solana',solana,trust);
  assert.match(message,/Solana Mainnet market loaded from on-chain/);
  assert.match(message,/review not established/i);
  assert.doesNotMatch(message,/Verified by PumpLite|Factory provenance not established/);
  const baseMessage=verificationStateText('base',{...solana,protocol:'v2'},trust);
  assert.equal(baseMessage,'Factory provenance not established.');
});
