import { readFile } from 'node:fs/promises';
import { checkJavaScriptAudit } from './dependency-policy.mjs';
const audit = JSON.parse(await readFile(process.argv[2] || 'build/dependency-audit.json', 'utf8'));
const review = JSON.parse(await readFile('docs/dependency-review.json', 'utf8'));
console.log('PASS dependency policy; ' + checkJavaScriptAudit(audit, review) + ' scoped advisory remains visible in docs/dependency-review.json');
