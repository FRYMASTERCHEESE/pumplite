import assert from "node:assert/strict";
import {
  POLICY,
  validSubject,
  validUploadPath,
  maxBytesForPath,
  validSha256,
  sha256Hex
} from "./src/policy.js";

assert.equal(validSubject("user_123"), true);
assert.equal(validSubject(""), false);
assert.equal(validSubject("../bad"), false);

assert.equal(validUploadPath("/metadata/image"), true);
assert.equal(validUploadPath("/metadata/json"), true);
assert.equal(validUploadPath("/rpc"), false);

assert.equal(maxBytesForPath("/metadata/image"), POLICY.maxImageBytes);
assert.equal(maxBytesForPath("/metadata/json"), POLICY.maxJsonBytes);
assert.equal(maxBytesForPath("/bad"), 0);

assert.equal(validSha256("a".repeat(64)), true);
assert.equal(validSha256("g".repeat(64)), false);

const digest = await sha256Hex("PumpLite");
assert.equal(digest, "a34d078dd546c8f9d617ab5fad802704a34e8a5e49e9014387d289fcaeeaeb68");

console.log("policy tests passed");
