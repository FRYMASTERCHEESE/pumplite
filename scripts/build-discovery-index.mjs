import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { indexPages } from './discovery-index.mjs';
const path = process.argv[2];
if (!path || (await stat(path)).size > 32_000_000) throw Error('Supply a public discovery snapshot JSON below 32 MB');
const pages = indexPages(JSON.parse(await readFile(path, 'utf8')));
await mkdir('build/market-index/solana', { recursive: true });
for (const [i,page] of pages.entries()) await writeFile('build/market-index/solana/' + i*8 + '.json',JSON.stringify(page)+'\n');
console.log('Built '+pages.length+' bounded public index pages; not published');
