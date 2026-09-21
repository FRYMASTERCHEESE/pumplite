// Query public registry package identities only. No RPC, wallet, or credentials.
// RustSec records are canonical; OSV also returns duplicate GHSA aliases.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const lock = await readFile('Cargo.lock', 'utf8');
const packages = lock.split('[[package]]').slice(1).filter(block => /source = "registry\+/.test(block)).map(block => ({
  name: block.match(/^name = "([^"]+)"/m)[1], version: block.match(/^version = "([^"]+)"/m)[1]
}));
if (!packages.length) throw Error('No registry packages found in Cargo.lock');
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error('Advisory service HTTP ' + response.status);
  return response.json();
}
const response = await json('https://api.osv.dev/v1/querybatch', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ queries: packages.map(p => ({ package: { name: p.name, ecosystem: 'crates.io' }, version: p.version })) })
});
if (response.results?.length !== packages.length || response.results.some(r => r.next_page_token)) throw Error('Incomplete advisory response');
const findings = response.results.flatMap((r, i) => (r.vulns ?? []).filter(v => v.id.startsWith('RUSTSEC-')).map(v => ({ ...packages[i], id: v.id })));
const details = new Map();
for (const { id } of findings) if (!details.has(id)) details.set(id, await json('https://api.osv.dev/v1/vulns/' + id));
let blockers = 0;
const report = findings.map(finding => {
  const detail = details.get(finding.id);
  const matching = detail.affected?.find(a => a.package?.name === finding.name);
  const informational = matching?.database_specific?.informational;
  const status = detail.withdrawn ? 'withdrawn' : informational ? 'warning' : 'vulnerability';
  if (status === 'vulnerability') blockers++;
  console.log(`${status.toUpperCase()} ${finding.name}@${finding.version}: ${finding.id} ${detail.summary}`);
  return { ...finding, status, informational, summary: detail.summary, url: `https://rustsec.org/advisories/${finding.id}.html` };
});
await mkdir('build', { recursive: true });
await writeFile('build/rustsec-audit.json', JSON.stringify({ scannedAt: new Date().toISOString(), packages: packages.length, findings: report }, null, 2) + '\n');
console.log(`Scanned ${packages.length} locked registry packages: ${blockers} RustSec vulnerabilities; informational warnings require release review.`);
if (blockers) process.exitCode = 1;
