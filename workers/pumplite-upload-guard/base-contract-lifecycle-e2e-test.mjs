import assert from 'node:assert/strict';
import {hashMessage} from 'ethers';
import {buildBaseIssueMessage} from './src/base-identity.js';
const url='http://127.0.0.1:8788';
async function post(path,body,token){return fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});}
const request={chain:'base',subject:'0x1111111111111111111111111111111111111111',path:'/metadata/image',bytes:123,sha256:'9'.repeat(64)};
const response=await post('/challenge',request);assert.equal(response.status,200);const challenge=await response.json();delete challenge.expiresAt;
const signature=hashMessage(buildBaseIssueMessage(challenge));
assert.equal((await post('/issue',{...challenge,signature:'0x1234'})).status,403);
assert.equal((await post('/issue',{...challenge,bytes:124,signature})).status,403);
assert.equal((await post('/issue',{...challenge,subject:'0x2222222222222222222222222222222222222222',signature})).status,403);
const issued=await post('/issue',{...challenge,signature});assert.equal(issued.status,200);const grant=await issued.json();
assert.equal((await post('/issue',{...challenge,signature})).status,409);
const authorization={path:request.path,bytes:request.bytes,sha256:request.sha256};
assert.equal((await post('/authorize',authorization,grant.token)).status,204);
assert.equal((await post('/authorize',authorization,grant.token)).status,403);
assert.equal((await post('/complete',{path:request.path,sha256:request.sha256,cid:'QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A'},grant.token)).status,204);
console.log('ERC-1271 local EVM + Durable Object lifecycle passed: invalid/tampered/undeployed rejected, issue, replay, authorize, complete');
