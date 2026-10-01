import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TOKEN =
  "0xb15A460142c77b42cDF57815b0eeFEb24b593196";

test("cross-platform Pages verification manifest is LF-pinned", async () => {
  const attrs = await readFile(".gitattributes", "utf8");

  assert.match(
    attrs,
    /^web\/token-verification\.json text eol=lf$/m
  );
});

test("main site keeps every existing route and adds verification/status discovery", async () => {
  const html = await readFile("index.html", "utf8");

  for (const existing of [
    'id="show-home"',
    'id="show-create"',
    'id="show-explore"',
    'id="show-help"',
    'href="./claim.html"',
    'href="./terms.html"',
    'href="./privacy.html"',
    'href="./risk.html"'
  ]) {
    assert.ok(
      html.includes(existing),
      "existing feature missing: " + existing
    );
  }

  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /href="\.\/verification\.html">Verify PLITE<\/a>/);
  assert.match(html, /href="\.\/status\.html">Live status<\/a>/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /property="og:type"/);
});

test("install metadata is local-only and does not introduce offline chain caching", async () => {
  const manifest = JSON.parse(
    await readFile("manifest.webmanifest", "utf8")
  );

  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(
    manifest.icons.every(icon =>
      String(icon.src).startsWith("./assets/")
    )
  );

  await assert.rejects(
    readFile("service-worker.js", "utf8"),
    error => error?.code === "ENOENT"
  );
});

test("public status center is read-only and canonical", async () => {
  const html = await readFile("status.html", "utf8");
  const source = await readFile("status.js", "utf8");

  assert.match(html, new RegExp(TOKEN, "i"));
  assert.match(source, new RegExp(TOKEN, "i"));

  for (const provider of [
    "sourcify.dev",
    "api.dexscreener.com",
    "api.geckoterminal.com",
    "base.blockscout.com"
  ]) {
    assert.ok(
      source.includes(provider),
      "missing public status provider: " + provider
    );
  }

  assert.doesNotMatch(
    source,
    /ETHERSCAN_API_KEY|BLOCKSCOUT_API_KEY|privateKey|mnemonic|seed phrase|sendTransaction|eth_sendRawTransaction|signTransaction/i
  );

  assert.doesNotMatch(
    html,
    /Connect wallet|Approve in wallet|Send transaction/i
  );
});

test("official discovery records remain one-token PLITE records", async () => {
  const list = JSON.parse(
    await readFile("token-list.json", "utf8")
  );

  const wellKnown = JSON.parse(
    await readFile(
      ".well-known/plite-token.json",
      "utf8"
    )
  );

  assert.equal(list.tokens.length, 1);
  assert.equal(list.tokens[0].chainId, 8453);
  assert.equal(
    list.tokens[0].address.toLowerCase(),
    TOKEN.toLowerCase()
  );

  assert.equal(
    wellKnown.token.address.toLowerCase(),
    TOKEN.toLowerCase()
  );

  assert.match(
    list.tokens[0].extensions.status,
    /status\.html$/
  );
});

test("security.txt publishes canonical security reporting metadata", async () => {
  const source = await readFile(
    ".well-known/security.txt",
    "utf8"
  );

  assert.match(source, /^Contact:\s+https:\/\//m);
  assert.match(source, /^Expires:\s+2027-/m);
  assert.match(
    source,
    /^Canonical:\s+https:\/\/frymastercheese\.github\.io\/pumplite\/\.well-known\/security\.txt$/m
  );
  assert.match(source, /^Policy:\s+https:\/\//m);
});

test("accessibility preferences have explicit fallbacks", async () => {
  const css = await readFile("web/styles.css", "utf8");

  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /prefers-contrast:more/);
});