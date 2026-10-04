// Public artifacts only. A canonical artifact is produced on the documented Linux CI profile.
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const solana=process.argv.includes('--solana'), canonical=process.argv.includes('--canonical');
const profile=process.platform==='linux' && process.arch==='x64' && (await readFile('/etc/os-release','utf8')).includes('VERSION_ID="24.04"');
if(canonical&&!profile)throw Error('Canonical release requires Ubuntu 24.04 x86_64');

const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim().length>0;
if(canonical&&dirty)throw Error('Canonical release requires a clean tracked source tree');

const paths=solana
 ? ['target/deploy/pumplite.so','target/idl/pumplite.json','Cargo.lock','tests/fixtures/metaplex/provenance.json','build/sbf-reproducibility.json','build/rustsec-audit.json']
 : ['build/base-v2/standard-input.json','build/base-v2/build-manifest.json','build/base-v2/LaunchFactoryV2.json','build/base-v2/CurveMarketV2.json','build/base-v2/LaunchTokenV2.json','build/dependency-audit.json'];

const files=[];
for(const path of paths){
 const bytes=await readFile(path);
 files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}

const config=JSON.parse(await readFile('config.json','utf8'));
if('transactionsEnabled' in config)throw Error('Legacy global transaction switch is not permitted');
if(
 config.solana.protocol!=='tiny' ||
 config.solana.programId!=='3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku' ||
 config.solana.transactionsEnabled!==false ||
 config.solana.genesisHash!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' ||
 config.solana.clientVersion!==5 ||
 config.solana.ammProgramId!==undefined ||
 config.solana.mayhemProgramId!==undefined ||
 !Array.isArray(config.solana.rpcFallbackUrls) ||
 config.solana.rpcFallbackUrls[0]!=='https://solana-rpc.publicnode.com'
)throw Error('Reviewed PumpLite tiny Mainnet integration configuration mismatch');

if(
 config.base.chainId!==8453 ||
 config.base.contractVersion!==2 ||
 config.base.factory.toLowerCase()!=='0xda8c34819ae397fd4be3c95947dea64f4a3278f4' ||
 config.base.transactionsEnabled!==true
)throw Error('Base V2 Mainnet release configuration mismatch');

const source=await readFile('programs/pumplite/src/lib.rs','utf8');

const manifest={
 schemaVersion:1,
 commit,
 dirty,
 profile:profile?'ubuntu-24.04-x86_64':process.platform+'-'+process.arch,
 canonical:canonical&&profile,
 programId:source.match(/declare_id!\("([^"]+)"\)/)[1],
 baseContractVersion:2,
 baseFactory:config.base.factory,
 treasuries:{solana:config.solana.treasury,base:config.base.treasury},
 tools:{rust:'1.94.0',agave:'3.1.10',anchor:'1.0.2',platformTools:'1.52',solc:'0.8.30'},
 files
};

await writeFile('build/release-'+(solana?'solana':'base')+'.json',JSON.stringify(manifest,null,2)+'\n');
console.log('PASS release manifest for '+commit+'; canonical='+manifest.canonical);
