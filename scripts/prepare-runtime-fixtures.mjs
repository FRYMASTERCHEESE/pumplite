import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const provenance = JSON.parse(await readFile('tests/fixtures/metaplex/provenance.json', 'utf8'));
const bytes = gunzipSync(await readFile('tests/fixtures/metaplex/token-metadata.so.gz'), { maxOutputLength: 2_000_000 });
if (createHash('sha256').update(bytes).digest('hex') !== provenance.sha256 || bytes.length !== provenance.bytes || bytes.subarray(0,4).toString('hex') !== '7f454c46') throw Error('Metaplex fixture integrity failure');
await mkdir('target/fixtures', { recursive: true });
await writeFile('target/fixtures/token-metadata.so', bytes);
console.log('PASS pinned public Metaplex runtime fixture ' + provenance.sha256);
