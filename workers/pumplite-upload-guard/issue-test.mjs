import assert from "node:assert/strict";
import { validateChallengeRequest } from "./src/issue.js";

const solanaSubject = "11111111111111111111111111111111";
const baseSubject = "0x1111111111111111111111111111111111111111";
const sha256 = "a".repeat(64);
const cid = "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A";

let r = validateChallengeRequest({
  chain: "solana",
  subject: solanaSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256
});
assert.equal(r.ok, true);

r = validateChallengeRequest({
  chain: "base",
  subject: baseSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256
});
assert.equal(r.ok, true);
assert.equal(r.value.subject, baseSubject.toLowerCase());

r = validateChallengeRequest({
  chain: "base",
  subject: "not-an-address",
  path: "/metadata/image",
  bytes: 1024,
  sha256
});
assert.equal(r.ok, false);

r = validateChallengeRequest({
  chain: "solana",
  subject: solanaSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256,
  imageCid: cid
});
assert.equal(r.ok, false);

r = validateChallengeRequest({
  chain: "solana",
  subject: solanaSubject,
  path: "/metadata/json",
  bytes: 1024,
  sha256
});
assert.equal(r.ok, false);

r = validateChallengeRequest({
  chain: "base",
  subject: baseSubject,
  path: "/metadata/json",
  bytes: 1024,
  sha256,
  imageCid: cid
});
assert.equal(r.ok, true);

r = validateChallengeRequest({
  chain: "bitcoin",
  subject: solanaSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256
});
assert.equal(r.ok, false);

r = validateChallengeRequest({
  chain: "solana",
  subject: solanaSubject,
  path: "/metadata/image",
  bytes: 999999999,
  sha256
});
assert.equal(r.ok, false);

r = validateChallengeRequest({
  chain: "solana",
  subject: solanaSubject,
  path: "/metadata/image",
  bytes: 1024,
  sha256,
  extra: "not allowed"
});
assert.equal(r.ok, false);

console.log("issue validator tests passed for Solana and Base");