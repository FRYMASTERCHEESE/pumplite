import assert from "node:assert/strict";
import { parseBearer, newGrantToken, hashGrantToken } from "./src/grants.js";

assert.equal(parseBearer("Bearer abcdefghijklmnop"), "abcdefghijklmnop");
assert.equal(parseBearer("Bearer short"), null);
assert.equal(parseBearer("Basic abcdefghijklmnop"), null);

const a = newGrantToken();
const b = newGrantToken();
assert.match(a, /^[a-f0-9]{64}$/);
assert.match(b, /^[a-f0-9]{64}$/);
assert.notEqual(a, b);

const h1 = await hashGrantToken(a);
const h2 = await hashGrantToken(a);
assert.equal(h1, h2);
assert.match(h1, /^[a-f0-9]{64}$/);

console.log("grant helper tests passed");
