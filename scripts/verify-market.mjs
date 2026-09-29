// Read-only chain access; only the reviewed registry file can be written.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { getAddress, keccak256, toUtf8Bytes } from 'ethers';
import { randomUUID } from 'node:crypto';
import { adapter, PUMPLITE_REVIEW_SCHEMA_UID } from '../web/adapters/base-v2.js';
import { validateRegistry, OFFICIAL_BASE_FACTORY, tokenTrust } from '../web/verification.js';

export const REVIEW_CHECKS = [
  'I checked the project is not impersonating another project.',
  'I manually checked all submitted website/X/Telegram/Discord links and they correspond to the project.',
  'I reviewed the actual metadata: name, ticker, description, image and optional banner are present/consistent.',
  'I checked for misleading or conflicting/duplicate identity details.'
];

function identityEntry(status, market, easUid, note = '', now = Date.now()) {
  return {
    status,
    easUid,
    market: getAddress(market.id),
    token: getAddress(market.token),
    creator: getAddress(market.creator),
    name: market.name,
    symbol: market.symbol,
    ...(market.uri ? { metadataURI: market.uri } : {}),
    reviewedAt: new Date(now).toISOString(),
    note
  };
}

function requireOfficialMarket(registry, market, now) {
  const trust = tokenTrust(
    'base',
    { chainId: 8453, factory: OFFICIAL_BASE_FACTORY },
    market,
    registry,
    now
  );
  if (!trust.created) throw Error('Official factory provenance required');
}

export function reviewedEntry(registry, market, confirmations, easUid, note = '', now = Date.now()) {
  validateRegistry(registry, now);
  requireOfficialMarket(registry, market, now);
  if (!market.uri) throw Error('Metadata is required for verification');
  if (!/^0x[0-9a-fA-F]{64}$/.test(easUid || '')) throw Error('Valid Base EAS attestation UID required');
  if (confirmations.length !== REVIEW_CHECKS.length || confirmations.some(value => value !== true)) {
    throw Error('All manual identity review checks must be confirmed');
  }
  return validateRegistry({
    version: 1,
    base: {
      ...registry.base,
      [market.id.toLowerCase()]: identityEntry('verified', market, easUid, note, now)
    }
  }, now);
}

export function declinedEntry(registry, market, easUid, note = '', now = Date.now()) {
  validateRegistry(registry, now);
  requireOfficialMarket(registry, market, now);
  if (!/^0x[0-9a-fA-F]{64}$/.test(easUid || '')) throw Error('Valid Base EAS attestation UID required');
  return validateRegistry({
    version: 1,
    base: {
      ...registry.base,
      [market.id.toLowerCase()]: identityEntry('declined', market, easUid, note, now)
    }
  }, now);
}

export function assertPortableProof(proof, market, config, decision) {
  const expectedCode = decision === 'verified' ? 1 : decision === 'declined' ? 2 : 0;
  if (!expectedCode) throw Error('Invalid portable review decision');
  const expectedMetadataHash = keccak256(toUtf8Bytes(String(market.uri || '')));
  if (
    !proof?.active ||
    proof.schema !== PUMPLITE_REVIEW_SCHEMA_UID ||
    proof.decision !== decision ||
    proof.decisionCode !== expectedCode ||
    getAddress(proof.attester) !== getAddress(config.treasury) ||
    getAddress(proof.recipient) !== getAddress(market.token) ||
    getAddress(proof.market) !== getAddress(market.id) ||
    getAddress(proof.token) !== getAddress(market.token) ||
    getAddress(proof.creator) !== getAddress(market.creator) ||
    getAddress(proof.factory) !== getAddress(config.factory) ||
    proof.metadataHash !== expectedMetadataHash
  ) throw Error('Portable Base EAS proof does not match the reviewed PumpLite market');
  return true;
}

async function openReader() {
  const config = JSON.parse(await readFile('config.json', 'utf8'));
  if (
    config.base.chainId !== 8453 ||
    config.base.factory.toLowerCase() !== OFFICIAL_BASE_FACTORY ||
    config.base.contractVersion !== 2
  ) throw Error('Official Base Mainnet V2 factory configuration required');
  const reader = adapter(config.base, () => {});
  return { config, reader };
}

export async function main(args = process.argv.slice(2)) {
  const [operation, input, easUid, ...notes] = args;
  if (!['verify', 'decline', 'remove'].includes(operation) || !input) {
    throw Error('Usage: node scripts/verify-market.mjs verify <market> <easUid> [note] | decline <market> <easUid> [note] | remove <market>');
  }
  if (operation === 'remove' && (easUid || notes.length)) throw Error('Remove only accepts a market address');
  if (operation !== 'remove' && !/^0x[0-9a-fA-F]{64}$/.test(easUid || '')) throw Error('Valid EAS attestation UID required');

  const id = getAddress(input);
  const path = resolve('web/verified-tokens.json');
  const original = await readFile(path, 'utf8');
  const registry = validateRegistry(JSON.parse(original));
  let next;

  if (operation === 'remove') {
    next = { version: 1, base: { ...registry.base } };
    delete next.base[id.toLowerCase()];
  } else {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw Error('Local review requires an interactive terminal. GitHub Actions uses the separate owner-review script.');
    }
    const { config, reader } = await openReader();
    let market, proof;
    try {
      market = await reader.market(id);
      proof = await reader.reviewAttestation(easUid);
    } finally {
      reader.close();
    }
    assertPortableProof(proof, market, config.base, operation === 'verify' ? 'verified' : 'declined');
    console.log(JSON.stringify({ chainId: 8453, market: id, token: market.token, creator: market.creator, name: market.name, symbol: market.symbol, metadataURI: market.uri, easUid }, null, 2));
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (operation === 'verify') {
        const checks = [];
        for (const check of REVIEW_CHECKS) checks.push((await terminal.question(check + ' Type yes: ')).trim() === 'yes');
        next = reviewedEntry(registry, market, checks, easUid, notes.join(' '));
      } else {
        const answer = (await terminal.question('Decline this identity/provenance verification? Type decline: ')).trim();
        if (answer !== 'decline') throw Error('Decline was not confirmed');
        next = declinedEntry(registry, market, easUid, notes.join(' '));
      }
    } finally {
      terminal.close();
    }
  }

  if (await readFile(path, 'utf8') !== original) throw Error('Registry changed while reviewing; retry without overwriting it');
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, path);
  console.log('Updated local review registry only. No wallet transaction was submitted by this script.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
