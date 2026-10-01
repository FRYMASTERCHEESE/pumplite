import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TOKEN =
  "0xb15A460142c77b42cDF57815b0eeFEb24b593196";

test(
  "no-key public indexer verifier is canonical and credential-free",
  async () => {
    const source = await readFile(
      "scripts/verify-public-token-indexers.mjs",
      "utf8"
    );

    assert.match(source, new RegExp(TOKEN, "i"));
    assert.match(source, /api\.dexscreener\.com/);
    assert.match(source, /api\.geckoterminal\.com/);
    assert.match(source, /base\.blockscout\.com/);
    assert.match(source, /basescan\.org/);
    assert.match(source, /sourcify\.dev/);

    assert.doesNotMatch(
      source,
      /ETHERSCAN_API_KEY|BLOCKSCOUT_API_KEY|api[_-]?key\s*[:=]/i
    );

    assert.doesNotMatch(
      source,
      /privateKey|seed phrase|mnemonic|sendTransaction|eth_sendRawTransaction/i
    );

    assert.match(
      source,
      /manual-review badges are never fabricated/i
    );
  }
);

test(
  "public PLITE identity files contain only the official Base token",
  async () => {
    const wellKnown = JSON.parse(
      await readFile(
        ".well-known/plite-token.json",
        "utf8"
      )
    );

    const tokenList = JSON.parse(
      await readFile("token-list.json", "utf8")
    );

    assert.equal(wellKnown.token.chainId, 8453);
    assert.equal(
      wellKnown.token.address.toLowerCase(),
      TOKEN.toLowerCase()
    );

    assert.equal(tokenList.tokens.length, 1);
    assert.equal(tokenList.tokens[0].chainId, 8453);
    assert.equal(
      tokenList.tokens[0].address.toLowerCase(),
      TOKEN.toLowerCase()
    );
  }
);