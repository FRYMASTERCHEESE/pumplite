import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test(
  'browser command starts and stops its own preview server',
  async () => {
    const pkg =
      JSON.parse(
        await readFile(
          'package.json',
          'utf8'
        )
      );

    const runner =
      await readFile(
        'tests/browser-runner.mjs',
        'utf8'
      );

    assert.equal(
      pkg.scripts['test:browser'],
      'node tests/browser-runner.mjs'
    );

    assert.match(
      runner,
      /scripts\/serve\.mjs/
    );

    assert.match(
      runner,
      /tests\/browser\.mjs/
    );

    assert.match(
      runner,
      /PREVIEW_URL/
    );

    assert.match(
      runner,
      /getFreePort/
    );

    assert.match(
      runner,
      /server\.kill/
    );

    assert.match(
      runner,
      /127\.0\.0\.1/
    );
  }
);