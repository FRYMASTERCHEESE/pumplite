import assert from "node:assert/strict";
import { readJson } from "./src/request.js";

const ok = new Request("https://local.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: 1 }) });
assert.deepEqual(await readJson(ok, 2048), { a: 1 });

let bad;
try {
  await readJson(new Request("https://local.test", { method: "POST", body: "{bad" }), 2048);
} catch (e) { bad = e; }
assert.equal(bad.status, 400);

let big;
try {
  await readJson(new Request("https://local.test", { method: "POST", body: "x".repeat(100) }), 16);
} catch (e) { big = e; }
assert.equal(big.status, 413);

console.log("request helper tests passed");
