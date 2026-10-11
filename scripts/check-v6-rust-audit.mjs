import {readFile} from 'node:fs/promises';
import {assertReviewCurrent} from './dependency-policy.mjs';
const audit=JSON.parse(await readFile('build/rust-audit.json','utf8'));
const review=JSON.parse(await readFile('docs/dependency-review.json','utf8'));
assertReviewCurrent(review);
if(!audit.database?.['last-commit'] || !Number.isInteger(audit.database['advisory-count']) ||
   !audit.vulnerabilities || audit.vulnerabilities.found !== false || audit.vulnerabilities.count !== 0 ||
   !Array.isArray(audit.vulnerabilities.list) || audit.vulnerabilities.list.length || audit.error) throw Error('Incomplete audit or Rust vulnerability found');
const graph=await readFile('build/v6-normal-dependencies.txt','utf8');
let count=0;
for(const [kind,findings] of Object.entries(audit.warnings||{})) {
  if(!Array.isArray(findings)) throw Error('Invalid audit warnings');
  for(const finding of findings) {
    const approved=review.rust.find(r=>r.id===finding.advisory?.id && r.name===finding.package?.name &&
      r.version===finding.package?.version && r.informational===kind);
    if(!approved) throw Error('Unreviewed Rust advisory: '+finding.advisory?.id);
    if(approved.scope.startsWith('Outside') && graph.includes(approved.name+' v'+approved.version))
      throw Error('Reviewed tooling advisory entered V6 program graph: '+approved.id);
    count++;
  }
}
console.log('PASS Rust vulnerability gate; '+count+' existing reviewed warnings remain visible. This is not independent audit approval.');
