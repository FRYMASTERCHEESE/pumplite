import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { securityHeaders } from './security-headers.mjs';
const headers = securityHeaders(await readFile('index.html','utf8'));
const files = { '_headers': '/*\n' + Object.entries(headers).map(([k,v])=>'  '+k+': '+v).join('\n')+'\n',
  'ops/security-headers.conf': '# Include in the HTTPS static-site server block. No RPC/signing proxy.\n'+Object.entries(headers).map(([k,v])=>'add_header '+k+' "'+v+'" always;').join('\n')+'\n' };
if (process.argv.includes('--check')) {
  for(const [path,text] of Object.entries(files)) if((await readFile(path,'utf8')).replace(/\r\n/g,'\n')!==text)throw Error('Stale security headers: '+path);
} else {
  await mkdir('ops',{recursive:true});
  for(const [path,text] of Object.entries(files)) await writeFile(path,text);
}
console.log('PASS static-host and nginx header configuration matches frontend CSP');
