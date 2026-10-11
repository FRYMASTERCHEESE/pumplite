import { build } from 'esbuild';
// Verify actual staged adapters can run in a browser. These files are not added
// to the production entry points or live configuration.
const result = await build({entryPoints:['web/adapters/base-v6.js','web/adapters/solana-v6.js'],
  bundle:true,outdir:'build/v6-browser',write:false,platform:'browser',format:'esm',target:['es2022'],metafile:true,
  define:{'process.env.NODE_ENV':'"production"'}});
for (const output of Object.values(result.metafile.outputs)) {
  if(output.imports.some(item=>item.external)) throw Error('Unresolved browser import');
  for(const [path,input] of Object.entries(output.inputs)) {
    if(input.bytesInOutput>0 && /\/(ganache|solc|playwright|stream-json)\//.test(path)) throw Error('Non-product browser dependency: '+path);
  }
}
console.log('PASS both isolated V6 browser bundles; no unresolved imports or excluded tooling packages');
