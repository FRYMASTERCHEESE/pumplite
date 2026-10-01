import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test(
  'PLITE token verification Steps 1001-5000 emit exactly 4,000 gates',
  async () => {
    const source =
      await readFile(
        'scripts/verify-token-verification-1001-5000.mjs',
        'utf8'
      );

    assert.match(source, /let next = 1001;/);
    assert.match(source, /next,\s*5001/);
    assert.match(source, /evidence\.length,\s*500/);

    const run =
      spawnSync(
        process.execPath,
        [
          'scripts/verify-token-verification-1001-5000.mjs'
        ],
        {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024
        }
      );

    assert.equal(
      run.status,
      0,
      [run.stdout, run.stderr]
        .filter(Boolean)
        .join('\n')
    );

    const numbers =
      Array.from(
        run.stdout.matchAll(
          /^PASS STEP (\d+) - /gm
        ),
        match => Number(match[1])
      );

    assert.equal(numbers.length, 4000);
    assert.equal(numbers[0], 1001);
    assert.equal(numbers.at(-1), 5000);
    assert.equal(new Set(numbers).size, 4000);

    for (
      let index = 0;
      index < numbers.length;
      index++
    ) {
      assert.equal(
        numbers[index],
        1001 + index
      );
    }

    assert.match(
      run.stdout,
      /PASS - PLITE TOKEN VERIFICATION STEPS 1001-5000/
    );

    assert.match(
      run.stdout,
      /4,000 token-verification evidence gates passed\./
    );
  }
);