import solc from "solc";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFile,
  mkdir,
  writeFile
} from "node:fs/promises";
import { readFileSync } from "node:fs";

const names = [
  "LaunchTokenV3",
  "CurveMarketV3",
  "LaunchFactoryV3"
];

const sources = Object.fromEntries(
  await Promise.all(
    names.map(async name => [
      name + ".sol",
      {
        content: (
          await readFile(
            "contracts/base/v3/" +
              name +
              ".sol",
            "utf8"
          )
        ).replace(/\r\n/g, "\n")
      }
    ])
  )
);

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: {
      enabled: true,
      runs: 200
    },
    evmVersion: "shanghai",
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.immutableReferences",
          "metadata"
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
        if (
          !path.startsWith(
            "@openzeppelin/contracts/"
          )
        ) {
          return {
            error:
              "Import rejected: " +
              path
          };
        }

        try {
          const content =
            readFileSync(
              "node_modules/" + path,
              "utf8"
            ).replace(/\r\n/g, "\n");

          sources[path] = {
            content
          };

          return {
            contents: content
          };
        } catch {
          return {
            error:
              "Missing import " +
              path
          };
        }
      }
    }
  )
);

for (const error of output.errors ?? []) {
  console[
    error.severity === "error"
      ? "error"
      : "warn"
  ](error.formattedMessage);
}

if (
  output.errors?.some(
    error =>
      error.severity === "error"
  )
) {
  process.exit(1);
}

const repeated = JSON.parse(
  solc.compile(
    JSON.stringify(input)
  )
);

for (const name of names) {
  const a =
    output.contracts[
      name + ".sol"
    ][name];

  const b =
    repeated.contracts[
      name + ".sol"
    ][name];

  for (const field of [
    "bytecode",
    "deployedBytecode"
  ]) {
    assert.equal(
      a.evm[field].object,
      b.evm[field].object,
      name +
        " " +
        field +
        " differs"
    );
  }

  assert.deepEqual(
    a.abi,
    b.abi
  );

  assert.equal(
    a.metadata,
    b.metadata
  );
}

const third = JSON.parse(
  solc.compile(
    JSON.stringify(input)
  )
);

assert.equal(
  JSON.stringify(third.contracts),
  JSON.stringify(repeated.contracts),
  "Standard-input repeat differs"
);

assert.match(
  solc.version(),
  /^0\.8\.30\+commit\.73712a01\./
);

await mkdir(
  "build/base-v3",
  { recursive: true }
);

await writeFile(
  "build/base-v3/standard-input.json",
  JSON.stringify(
    input,
    null,
    2
  ) + "\n"
);

const sha256 = value =>
  createHash("sha256")
    .update(value)
    .digest("hex");

const manifest = {
  compiler: solc.version(),
  settings: input.settings,
  sources: Object.fromEntries(
    Object.entries(sources).map(
      ([name, source]) => [
        name,
        sha256(source.content)
      ]
    )
  ),
  contracts: {}
};

await mkdir(
  "web/generated",
  { recursive: true }
);

const abis = {};

for (const name of names) {
  const artifact =
    output.contracts[
      name + ".sol"
    ][name];

  const runtimeBytes =
    artifact.evm.deployedBytecode
      .object.length / 2;

  const initBytes =
    artifact.evm.bytecode
      .object.length / 2;

  if (runtimeBytes > 24576) {
    throw new Error(
      name +
        " exceeds deployed bytecode limit: " +
        runtimeBytes
    );
  }

  if (initBytes > 49152) {
    throw new Error(
      name +
        " exceeds initcode limit: " +
        initBytes
    );
  }

  abis[name] = artifact.abi;

  manifest.contracts[name] = {
    creationSha256: sha256(
      Buffer.from(
        artifact.evm.bytecode.object,
        "hex"
      )
    ),
    runtimeTemplateSha256:
      sha256(
        Buffer.from(
          artifact.evm.deployedBytecode
            .object,
          "hex"
        )
      ),
    runtimeBytes,
    initBytes
  };

  await writeFile(
    "build/base-v3/" +
      name +
      ".json",
    JSON.stringify(
      artifact,
      null,
      2
    ) + "\n"
  );

  console.log(
    name +
      ": compiled; runtime " +
      runtimeBytes +
      " bytes; init " +
      initBytes +
      " bytes"
  );
}

await writeFile(
  "web/generated/base-v3-abi.json",
  JSON.stringify(
    abis,
    null,
    2
  ) + "\n"
);

await writeFile(
  "build/base-v3/build-manifest.json",
  JSON.stringify(
    manifest,
    null,
    2
  ) + "\n"
);

console.log(
  "PASS identical V3 Solidity repeat compilation and self-contained verification input"
);