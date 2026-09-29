// Offline public-artifact verification only. No RPC, wallet, signer or deployment.
import { readFile, mkdir, copyFile, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const OFFICIAL_V2_FACTORY='0xda8c34819ae397fd4be3c95947dea64f4a3278f4';

const inventories = {
  solana: ['target/deploy/pumplite.so','target/idl/pumplite.json','Cargo.lock','tests/fixtures/metaplex/provenance.json','build/sbf-reproducibility.json','build/rustsec-audit.json'],
  base: ['build/base-v2/standard-input.json','build/base-v2/build-manifest.json','build/base-v2/LaunchFactoryV2.json','build/base-v2/CurveMarketV2.json','build/base-v2/LaunchTokenV2.json','build/dependency-audit.json']
};

export async function verifyPackage(root, kind, expectedCommit, canonical = true) {
  if (!inventories[kind] || !/^[a-f0-9]{40}$/.test(expectedCommit)) throw Error('Specify chain and full trusted commit SHA');

  root = await realpath(root);

  async function bytes(path) {
    const full = resolve(root, path), actual = await realpath(full);
    if (!actual.startsWith(root + sep) || (await lstat(full)).isSymbolicLink()) throw Error('Artifact escapes package or is a symlink');
    return readFile(full);
  }

  const manifest = JSON.parse(await bytes('release-' + kind + '.json'));

  if (
    manifest.schemaVersion !== 1 ||
    manifest.commit !== expectedCommit ||
    (canonical && (
      manifest.canonical !== true ||
      manifest.dirty !== false ||
      manifest.profile !== 'ubuntu-24.04-x86_64'
    ))
  ) throw Error('Wrong commit or noncanonical release');

  if (
    manifest.treasuries?.solana !== 'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct' ||
    manifest.treasuries?.base !== '0x0de7fdcc798f7fac6b03b366c529133a9c60794d'
  ) throw Error('Wrong release treasury');

  if (kind === 'base') {
    if (
      manifest.baseContractVersion !== 2 ||
      String(manifest.baseFactory).toLowerCase() !== OFFICIAL_V2_FACTORY
    ) throw Error('Wrong Base V2 deployment identity');
  }

  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length !== inventories[kind].length ||
    new Set(manifest.files.map(f => f.path)).size !== manifest.files.length ||
    manifest.files.some(f => !inventories[kind].includes(f.path))
  ) throw Error('Unexpected release inventory');

  for (const file of manifest.files) {
    const data = await bytes(file.path);

    if (
      !Number.isSafeInteger(file.bytes) ||
      file.bytes !== data.length ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      createHash('sha256').update(data).digest('hex') !== file.sha256
    ) throw Error('Artifact digest mismatch: ' + file.path);
  }

  if (kind === 'solana') {
    const idl = JSON.parse(await bytes('target/idl/pumplite.json'));

    if (!manifest.programId || idl.address !== manifest.programId) {
      throw Error('IDL and program identity differ');
    }

    const report = JSON.parse(await bytes('build/sbf-reproducibility.json'));
    const digest = manifest.files.find(file => file.path === 'target/deploy/pumplite.so').sha256;

    if (
      report.identical !== true ||
      report.first !== digest ||
      report.second !== digest
    ) throw Error('Reproducibility evidence does not match packaged program');

    const program = await bytes('target/deploy/pumplite.so');

    if (!program.subarray(0,4).equals(Buffer.from([127,69,76,70]))) {
      throw Error('Program is not ELF');
    }
  }

  return manifest;
}

export async function packageRelease(kind) {
  if (!inventories[kind]) throw Error('Unknown chain');

  const output = 'build/release-packages/' + kind;

  for (const path of inventories[kind]) {
    await mkdir(dirname(resolve(output,path)), { recursive: true });
    await copyFile(path, resolve(output,path));
  }

  await copyFile(
    'build/release-' + kind + '.json',
    output + '/release-' + kind + '.json'
  );

  return output;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [mode, kind, root, commit] = process.argv.slice(2);

  if (mode === 'pack') {
    const output = await packageRelease(kind);
    const m = JSON.parse(await readFile(output + '/release-' + kind + '.json'));
    await verifyPackage(output, kind, m.commit);
    console.log('PASS canonical self-contained ' + kind + ' release package');
  } else if (mode === 'verify') {
    await verifyPackage(root, kind, commit);
    console.log('PASS offline artifact integrity for ' + commit + '; not deployment or audit approval');
  } else {
    throw Error('Usage: release-package.mjs pack CHAIN | verify CHAIN DIRECTORY TRUSTED_COMMIT');
  }
}
