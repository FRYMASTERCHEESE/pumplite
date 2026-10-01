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