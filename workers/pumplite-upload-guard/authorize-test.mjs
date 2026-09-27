import assert from "node:assert/strict";
import { validateAuthorizeRequest } from "./src/authorize.js";

const sha = "a".repeat(64);
const cid = "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A";
const now = 100000;

const grant = {
  subject: "wallet_123",
  path: "/metadata/image",
  max_bytes: 512 * 1024,
  expected_sha256: sha,
  expires_at: now + 60000,
  consumed_at: null,
  completed_at: null
};

const usage = {
  subjectRequests: 0,
  subjectBytes: 0,
  globalRequests: 0,
  globalBytes: 0
};

assert.deepEqual(
  validateAuthorizeRequest({
    grant,
    body: { path: "/metadata/image", bytes: 1024, sha256: sha },
    now,
    usage,
    ownedImage: null
  }),
  { allowed: true, status: 204, reason: null }
);

assert.equal(
  validateAuthorizeRequest({
    grant: { ...grant, expires_at: now },
    body: { path: "/metadata/image", bytes: 1024, sha256: sha },
    now,
    usage,
    ownedImage: null
  }).reason,
  "grant_invalid"
);

const jsonGrant = {
  ...grant,
  path: "/metadata/json",
  max_bytes: 4096
};

assert.equal(
  validateAuthorizeRequest({
    grant: jsonGrant,
    body: { path: "/metadata/json", bytes: 512, sha256: sha, imageCid: cid },
    now,
    usage,
    ownedImage: null
  }).reason,
  "image_not_owned"
);

assert.deepEqual(
  validateAuthorizeRequest({
    grant: jsonGrant,
    body: { path: "/metadata/json", bytes: 512, sha256: sha, imageCid: cid },
    now,
    usage,
    ownedImage: { cid, subject: "wallet_123" }
  }),
  { allowed: true, status: 204, reason: null }
);

assert.equal(
  validateAuthorizeRequest({
    grant,
    body: { path: "/metadata/image", bytes: 1024, sha256: sha },
    now,
    usage: { ...usage, subjectRequests: 10 },
    ownedImage: null
  }).status,
  429
);

console.log("authorize validator tests passed");
