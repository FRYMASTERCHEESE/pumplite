import solc from 'solc';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const source = (
  await readFile(
    'contracts/base/claim/PLITEHolderClaim.sol',
    'utf8'
  )
).replace(/\r\n/g, '\n');

const input = {
  language: 'Solidity',
  sources: {
    'PLITEHolderClaim.sol': { content: source }
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'shanghai',
    outputSelection: {
      '*': {
        '*': [
          'abi',
          'evm.bytecode.object',
          'evm.deployedBytecode.object',
          'evm.deployedBytecode.immutableReferences',
          'metadata'
        ]
      }
    }
  }
};

const output = JSON.parse(
  solc.compile(
    JSON.stringify(input),
    {
      import(path) {
        if (!path.startsWith('@openzeppelin/contracts/')) {
          return { error: 'Import rejected: ' + path };
        }

        try {
          return {
            contents: readFileSync(
              'node_modules/' + path,
              'utf8'
            ).replace(/\r\n/g, '\n')
          };
        } catch {
          return { error: 'Missing import ' + path };
        }
      }
    }
  )
);

for (const error of output.errors ?? []) {
  console[
    error.severity === 'error' ? 'error' : 'warn'
  ](error.formattedMessage);
}

if (
  output.errors?.some(
    error => error.severity === 'error'
  )
) {
  process.exit(1);
}

const artifact =
  output.contracts['PLITEHolderClaim.sol']
    .PLITEHolderClaim;

const runtimeBytes =
  artifact.evm.deployedBytecode.object.length / 2;

if (runtimeBytes > 24_576) {
  throw Error('PLITEHolderClaim exceeds runtime bytecode limit');
}

await mkdir('build/plite-holder-claim', {
  recursive: true
});
await mkdir('web/generated', {
  recursive: true
});

await writeFile(
  'build/plite-holder-claim/PLITEHolderClaim.json',
  JSON.stringify(artifact, null, 2) + '\n'
);

const browserArtifact = {
  abi: artifact.abi,
  bytecode: '0x' + artifact.evm.bytecode.object,
  deployedBytecode:
    '0x' + artifact.evm.deployedBytecode.object,
  immutableReferences:
    artifact.evm.deployedBytecode.immutableReferences
};

await writeFile(
  'web/generated/plite-holder-claim.json',
  JSON.stringify(browserArtifact, null, 2) + '\n'
);

const sha256 = value =>
  createHash('sha256').update(value).digest('hex');

console.log(
  'PLITEHolderClaim compiled; runtime ' +
  runtimeBytes +
  ' bytes; source sha256 ' +
  sha256(source)
);