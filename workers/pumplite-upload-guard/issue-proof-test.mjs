import assert from "node:assert/strict";
import { validateIssueProof } from "./src/issue-proof.js";

const solanaSubject = "11111111111111111111111111111111";
const baseSubject = "0x1111111111111111111111111111111111111111";
const sha256 = "a".repeat(64);
const nonce = "b".repeat(32);
const solanaSignature = "A".repeat(86) + "==";
const baseSignature = "0x" + "11".repeat(65);
const issuedAt = 1790520077717;
const cid = "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A";

let r = validateIssueProof({
  chain: "solana",
  subject: solanaSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256,
  issuedAt,
  nonce,
  signature: solanaSignature
});
assert.equal(r.ok, true);

r = validateIssueProof({
  chain: "base",
  subject: baseSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256,
  issuedAt,
  nonce,
  signature: baseSignature
});
assert.equal(r.ok, true);
assert.equal(r.value.subject, baseSubject.toLowerCase());

r = validateIssueProof({
  chain: "base",
  subject: "not-an-address",
  path: "/metadata/image",
  bytes: 1024,
  sha256,
  issuedAt,
  nonce,
  signature: baseSignature
});
assert.equal(r.ok, false);

r = validateIssueProof({
  chain: "base",
  subject: baseSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256,
  issuedAt,
  nonce,
  signature: solanaSignature
});
assert.equal(r.ok, false);

r = validateIssueProof({
  chain: "solana",
  subject: solanaSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256,
  issuedAt,
  nonce,
  signature: baseSignature
});
assert.equal(r.ok, false);

r = validateIssueProof({
  chain: "base",
  subject: baseSubject,
  path: "/metadata/json",
  bytes: 1024,
  sha256,
  imageCid: cid,
  issuedAt,
  nonce,
  signature: baseSignature
});
assert.equal(r.ok, true);

r = validateIssueProof({
  chain: "bitcoin",
  subject: solanaSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256,
  issuedAt,
  nonce,
  signature: solanaSignature
});
assert.equal(r.ok, false);

console.log("issue proof validator tests passed for Solana and Base");