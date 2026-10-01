import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test(
  "no-key public verification workflow is read-only and credential-free",
  async () => {
    const source = await readFile(
      ".github/workflows/public-token-indexers.yml",
      "utf8"
    );

    assert.match(
      source,
      /permissions:\s*\n\s*contents:\s*read/
    );

    assert.match(
      source,
      /persist-credentials:\s*false/
    );

    assert.doesNotMatch(
      source,
      /contents:\s*write|pull_request_target\s*:|secrets\./
    );

    for (const line of source.split("\n")) {
      const match = line.match(/\buses:\s*([^\s#]+)/);

      if (!match) continue;

      const use = match[1];
      const at = use.lastIndexOf("@");

      assert.ok(at > 0);
      assert.match(
        use.slice(at + 1),
        /^[0-9a-f]{40}$/i
      );
    }
  }
);