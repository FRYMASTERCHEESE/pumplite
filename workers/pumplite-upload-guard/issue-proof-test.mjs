import assert from "node:assert/strict";
import { validateIssueProof } from "./src/issue-proof.js";

const subject = "11111111111111111111111111111111";
const sha256 = "a".repeat(64);
const nonce = "b".repeat(32);
const signature = "A".repeat(86) + "==";
const issuedAt = 1790520077717;
const cid = "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A";

const base = {
  chain: "solana",
  subject,
  path: "/metadata/image",
  bytes: 1024,
  sha256,
  issuedAt,
  nonce,
  signature
};

let r = validateIssueProof(base);
assert.equal(r.ok, true);

r = validateIssueProof({ ...base, chain: "base" });
assert.equal(r.ok, false);

r = validateIssueProof({ ...base, nonce: "bad-nonce" });
assert.equal(r.ok, false);

r = validateIssueProof({ ...base, signature: "not-a-signature" });
assert.equal(r.ok, false);

r = validateIssueProof({ ...base, bytes: 999999999 });
assert.equal(r.ok, false);

r = validateIssueProof({ ...base, imageCid: cid });
assert.equal(r.ok, false);

r = validateIssueProof({
  ...base,
  path: "/metadata/json"
});
assert.equal(r.ok, false);

r = validateIssueProof({
  ...base,
  path: "/metadata/json",
  imageCid: cid
});
assert.equal(r.ok, true);

r = validateIssueProof({
  ...base,
  extra: "not allowed"
});
assert.equal(r.ok, false);

console.log("issue proof validator tests passed");