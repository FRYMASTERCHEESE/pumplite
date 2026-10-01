import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test(
  'production verification hardening Steps 401-1000 expose exactly 600 gates',
  async () => {
    const source =
      await readFile(
        'scripts/verify-hardening-401-1000.mjs',
        'utf8'
      );

    assert.match(
      source,
      /let next = 401;/
    );

    assert.match(
      source,
      /next,\s*1001/
    );

    const run =
      spawnSync(
        process.execPath,
        [
          'scripts/verify-hardening-401-1000.mjs'
        ],
        {
          encoding: 'utf8'
        }
      );

    assert.equal(
      run.status,
      0,
      [
        run.stdout,
        run.stderr
      ].filter(Boolean).join('\n')
    );

    const numbers =
      Array.from(
        run.stdout.matchAll(
          /^PASS STEP (\d+) - /gm
        ),
        match => Number(match[1])
      );

    assert.equal(
      numbers.length,
      600
    );

    assert.equal(
      numbers[0],
      401
    );

    assert.equal(
      numbers.at(-1),
      1000
    );

    assert.equal(
      new Set(numbers).size,
      600
    );

    for (
      let index = 0;
      index < numbers.length;
      index++
    ) {
      assert.equal(
        numbers[index],
        401 + index
      );
    }

    assert.match(
      run.stdout,
      /PASS - PRODUCTION VERIFICATION HARDENING STEPS 401-1000/
    );

    assert.match(
      run.stdout,
      /600 static\/local verification gates passed\./
    );
  }
);
test(
  'hardening inventory never pins generated chunk hashes',
  async () => {
    const source =
      await readFile(
        'scripts/verify-hardening-401-1000.mjs',
        'utf8'
      );

    assert.doesNotMatch(
      source,
      /assets\/chunks\/[A-Za-z0-9_-]+\.js/,
      'Hardening inventory must use stable source paths, not esbuild hash filenames'
    );

    for (const path of [
      'contracts/base/v3/CurveMarketV3.sol',
      'contracts/base/v3/LaunchFactoryV3.sol',
      'contracts/base/v3/LaunchTokenV3.sol',
      'docs/MAYHEM_V3.md',
      'scripts/compile-base-v3.mjs',
      'tests/base-v3-candidate.mjs',
      'tests/base-v3-static-candidate.mjs',
      'tests/v3-deploy-page.test.mjs',
      'v3-deploy.html',
      'web/adapters/base-v3.js'
    ]) {
      assert.ok(
        source.includes(
          JSON.stringify(path)
        ),
        'Stable V3 hardening inventory path missing: ' +
          path
      );
    }
  }
);