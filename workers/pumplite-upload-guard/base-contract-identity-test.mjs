import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, hashMessage } from 'ethers';
import { verifyBaseIssueSignature, buildBaseIssueMessage } from './src/base-identity.js';
import { validateIssueProof } from './src/issue-proof.js';
const abi = new Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)']);
const proof = {chain:'base',subject:'0x1111111111111111111111111111111111111111',path:'/metadata/image',bytes:1024,sha256:'a'.repeat(64),issuedAt:Date.now(),nonce:'b'.repeat(32),signature:'0x1234'};
const magic = '0x1626ba7e'+'0'.repeat(56);
function fixture(mode) {
  const calls=[];
  return {calls,async fetch(url,options){
    assert.equal(url,'https://mainnet.base.org');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
    const r=JSON.parse(options.body);calls.push(r);
    if(mode==='throw')throw Error('private upstream error');
    if(mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid'}});
    if(mode==='revert' && r.method==='eth_call')return Response.json({jsonrpc:'2.0',id:r.id,error:{code:3,message:'execution reverted'}});
    if(mode==='http')return new Response('private upstream error',{status:403});
    if(mode==='oversize')return new Response('x'.repeat(65537));
    if(mode==='malformed')return new Response('{');
    let result;
    if(r.method==='eth_chainId')result=mode==='wrong-chain'?'0x1':'0x2105';
    if(r.method==='eth_blockNumber')result=mode==='bad-block'?'latest':'0x123';
    if(r.method==='eth_getCode'){assert.deepEqual(r.params,[proof.subject,'0x123']);result=mode==='no-code'?'0x':mode==='bad-code'?'0x1':'0x6000';}
    if(r.method==='eth_call'){
      assert.equal(r.params[1],'0x123');assert.equal(r.params[0].to,proof.subject);assert.equal(r.params[0].gas,'0x7a120');
      const [digest,signature]=abi.decodeFunctionData('isValidSignature',r.params[0].data);
      assert.equal(digest,hashMessage(buildBaseIssueMessage(proof)));assert.equal(signature,proof.signature);
      result=mode==='wrong-magic'?'0xffffffff'+'0'.repeat(56):mode==='short'?'0x1626ba7e':mode==='suffix'?magic+'00':mode==='padding'?magic.slice(0,-1)+'1':magic;
    }
    return Response.json(mode==='rpc-error'?{jsonrpc:'2.0',id:r.id,error:{message:'private'}}:{jsonrpc:'2.0',id:mode==='wrong-id'?999:r.id,result});
  }};
}
for(const mode of ['success','redirect','revert','wrong-chain','bad-block','no-code','bad-code','wrong-magic','short','suffix','padding','throw','http','oversize','malformed','rpc-error','wrong-id'])test('ERC-1271 '+mode,async()=>{const rpc=fixture(mode);assert.equal(await verifyBaseIssueSignature(proof,rpc),mode==='success');assert.ok(rpc.calls.length<=4);if(mode==='wrong-chain')assert.equal(rpc.calls.length,1);});
test('bounded variable-length signatures pass shape validation; malformed and wrapped signatures fail before RPC',async()=>{for(const signature of ['0x','0x1234','0x'+'ab'.repeat(512)])assert.equal(validateIssueProof({...proof,signature}).ok,true);for(const signature of ['0x1','0xzz','0x'+'ab'.repeat(513),'0x'+'6492'.repeat(16),null]){const rpc=fixture();assert.equal(validateIssueProof({...proof,signature}).ok,false);assert.equal(await verifyBaseIssueSignature({...proof,signature},rpc),false);assert.equal(rpc.calls.length,0);}});
test('RPC timeout fails closed even when the transport ignores abort',async t=>{t.mock.timers.enable({apis:['setTimeout']});const result=verifyBaseIssueSignature(proof,{fetch:()=>new Promise(()=>{})});t.mock.timers.tick(10001);assert.equal(await result,false);});
