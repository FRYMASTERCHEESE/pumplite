import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { buildBaseIssueMessage } from "./src/base-identity.js";

const wallet = Wallet.createRandom();
const sha256 = "6".repeat(64);
const cid = "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A";

const challengeResponse = await fetch(
  "http://127.0.0.1:8788/challenge",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chain: "base",
      subject: wallet.address,
      path: "/metadata/image",
      bytes: 2048,
      sha256
    })
  }
);

assert.equal(challengeResponse.status, 200);
const challenge = await challengeResponse.json();

const message = buildBaseIssueMessage(challenge);
const signature = await wallet.signMessage(message);

const proof = {
  ...challenge,
  signature
};

delete proof.expiresAt;

const issueResponse = await fetch(
  "http://127.0.0.1:8788/issue",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proof)
  }
);

assert.equal(issueResponse.status, 200);

const grant = await issueResponse.json();

assert.equal(grant.chain, "base");
assert.match(grant.token, /^[a-f0-9]{64}$/);

console.log("Base grant issued");

const prematureComplete = await fetch(
  "http://127.0.0.1:8788/complete",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${grant.token}`
    },
    body: JSON.stringify({
      path: "/metadata/image",
      sha256,
      cid
    })
  }
);

assert.notEqual(prematureComplete.status, 204);
console.log("Base completion before authorization blocked");

const authorizeResponse = await fetch(
  "http://127.0.0.1:8788/authorize",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${grant.token}`
    },
    body: JSON.stringify({
      path: "/metadata/image",
      bytes: 2048,
      sha256
    })
  }
);

assert.equal(authorizeResponse.status, 204);
console.log("Base grant authorized");

const authorizeReplay = await fetch(
  "http://127.0.0.1:8788/authorize",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${grant.token}`
    },
    body: JSON.stringify({
      path: "/metadata/image",
      bytes: 2048,
      sha256
    })
  }
);

assert.notEqual(authorizeReplay.status, 204);
console.log("Base authorization replay blocked");

const completeResponse = await fetch(
  "http://127.0.0.1:8788/complete",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${grant.token}`
    },
    body: JSON.stringify({
      path: "/metadata/image",
      sha256,
      cid
    })
  }
);

assert.equal(completeResponse.status, 204);
console.log("Base completion recorded");

const completeReplay = await fetch(
  "http://127.0.0.1:8788/complete",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${grant.token}`
    },
    body: JSON.stringify({
      path: "/metadata/image",
      sha256,
      cid
    })
  }
);

assert.notEqual(completeReplay.status, 204);
console.log("Base completion replay blocked");

console.log("FULL BASE IMAGE LIFECYCLE PASSED");