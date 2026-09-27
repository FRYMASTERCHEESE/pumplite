import assert from "node:assert/strict";
import { validateComplete } from "./src/complete.js";

const sha = "a".repeat(64);
const cid = "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A";
const now = 100000;

const grant = {
  path: "/metadata/image",
  expected_sha256: sha,
  expires_at: now + 60000,
  consumed_at: now - 1000,
  completed_at: null
};

assert.deepEqual(
  validateComplete({
    grant,
    body: { path: "/metadata/image", sha256: sha, cid },
    now
  }),
  { ok: true, status: 204, reason: null }
);

assert.equal(
  validateComplete({
    grant: { ...grant, consumed_at: null },
    body: { path: "/metadata/image", sha256: sha, cid },
    now
  }).reason,
  "grant_invalid"
);

assert.equal(
  validateComplete({
    grant,
    body: { path: "/metadata/image", sha256: "b".repeat(64), cid },
    now
  }).reason,
  "grant_mismatch"
);

assert.equal(
  validateComplete({
    grant,
    body: { path: "/metadata/image", sha256: sha, cid: "not-a-cid" },
    now
  }).reason,
  "grant_mismatch"
);

console.log("complete validator tests passed");
