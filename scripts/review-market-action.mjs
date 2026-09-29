import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAddress } from 'ethers';
import { adapter } from '../web/adapters/base-v2.js';
import { OFFICIAL_BASE_FACTORY, validateRegistry } from '../web/verification.js';
import { REVIEW_CHECKS, reviewedEntry, declinedEntry, assertPortableProof } from './verify-market.mjs';

const decision = process.env.PUMPLITE_REVIEW_DECISION || '';
const rawMarket = process.env.PUMPLITE_REVIEW_MARKET || '';
const easUid = process.env.PUMPLITE_REVIEW_EAS_UID || '';
const note = process.env.PUMPLITE_REVIEW_NOTE || '';
const confirmation = process.env.PUMPLITE_REVIEW_CONFIRMATION || '';

if (!['verify', 'decline', 'revoke'].includes(decision)) throw Error('Decision must be verify, decline or revoke');
if (confirmation !== 'I REVIEWED THIS TOKEN') throw Error('Manual owner review confirmation was not supplied');
if (!/^0x[0-9a-fA-F]{64}$/.test(easUid)) throw Error('Valid Base EAS attestation UID required');

const marketId = getAddress(rawMarket);
const config = JSON.parse(await readFile('config.json', 'utf8'));
if (
  config.base.chainId !== 8453 ||
  config.base.contractVersion !== 2 ||
  config.base.factory.toLowerCase() !== OFFICIAL_BASE_FACTORY
) throw Error('Official Base V2 configuration required');

const reader = adapter(config.base, message => console.log(message));
let market, proof;
try {
  market = await reader.market(marketId);
  proof = await reader.reviewAttestation(easUid);
} finally {
  reader.close();
}

const path = resolve('web/verified-tokens.json');
const original = await readFile(path, 'utf8');
const registry = validateRegistry(JSON.parse(original));
let next;

if (decision === 'revoke') {
  const current = registry.base[marketId.toLowerCase()];
  if (!current || current.easUid.toLowerCase() !== easUid.toLowerCase()) throw Error('The registry does not mirror this EAS UID');
  if (proof.revocationTime === 0n) throw Error('The EAS proof is not revoked on Base');
  next = { version: 1, base: { ...registry.base } };
  delete next.base[marketId.toLowerCase()];
} else {
  assertPortableProof(proof, market, config.base, decision === 'verify' ? 'verified' : 'declined');
  next = decision === 'verify'
    ? reviewedEntry(registry, market, REVIEW_CHECKS.map(() => true), easUid, note)
    : declinedEntry(registry, market, easUid, note);
}

console.log(JSON.stringify({ decision, market: market.id, token: market.token, creator: market.creator, name: market.name, symbol: market.symbol, metadataURI: market.uri, easUid, easActive: proof.active, easRevocationTime: proof.revocationTime.toString() }, null, 2));

if (await readFile(path, 'utf8') !== original) throw Error('Registry changed during review');
const temporary = path + '.' + randomUUID() + '.tmp';
await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
await rename(temporary, path);
console.log('PASS protected owner review registry updated from a validated Base EAS proof. No wallet transaction was submitted by GitHub Actions.');
