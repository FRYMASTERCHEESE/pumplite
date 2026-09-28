import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { securityHeaders } from '../scripts/security-headers.mjs';
const config = JSON.parse(await readFile('config.json'));
const html = await readFile('index.html','utf8');
test('Solana uses only the public read-only proxy address and verified fallback with deployment locks',()=>{
 assert.equal(config.solana.rpcUrl,'https://pumplite-rpc.coreyedge123.workers.dev/rpc');
 assert.deepEqual(config.solana.rpcFallbackUrls,['https://solana-rpc.publicnode.com']);
 assert.equal(config.solana.genesisHash,'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
 assert.equal(config.solana.transactionsEnabled,false);assert.equal(config.base.transactionsEnabled,true);assert.equal(config.solana.programId,null);assert.equal(config.base.factory,'0xf722BeD94c4A41B2C71cDCDEB5EEA062352aEe44');
 assert.equal(config.solana.treasury,'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct');
 assert.equal(config.base.treasury,'0x0de7fdcc798f7fac6b03b366c529133a9c60794d');
 assert.equal(config.base.rpcUrl,'https://mainnet.base.org');
 const url=new URL(config.solana.rpcUrl);assert.equal(url.search,'');assert.equal(url.username,'');assert.equal(url.password,'');
});
test('CSP grants only the exact Worker HTTPS origin and existing fallback/Base destinations',()=>{
 const policy=securityHeaders(html)['Content-Security-Policy'];
 const sources=policy.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src ')).split(/\s+/).slice(1);
 assert.deepEqual(sources,["'self'",'https://pumplite-rpc.coreyedge123.workers.dev','https://solana-rpc.publicnode.com','wss://solana-rpc.publicnode.com','https://mainnet.base.org']);
});
