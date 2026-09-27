import {build} from 'esbuild';
// Local bundle only. No Cloudflare API, secret access, or deployment.
await build({entryPoints:['workers/pumplite-rpc/worker.js'],outfile:'build/cloudflare/worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',sourcemap:false});
console.log('Prepared build/cloudflare/worker.js locally; nothing deployed');
