import assert from "node:assert/strict";
import { buildSolanaIssueMessage } from "./src/solana-identity.js";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);

  let out = "";
  while (n > 0n) {
    const mod = Number(n % 58n);
    out = B58[mod] + out;
    n /= 58n;
  }

  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  return "1".repeat(zeros) + out;
}

const keys = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"]
);

const publicRaw = new Uint8Array(
  await crypto.subtle.exportKey("raw", keys.publicKey)
);

const subject = encodeBase58(publicRaw);
const sha256 = "c".repeat(64);

const challengeResponse = await fetch("http://127.0.0.1:8788/challenge", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chain: "solana",
    subject,
    path: "/metadata/image",
    bytes: 2048,
    sha256
  })
});

assert.equal(challengeResponse.status, 200);
const challenge = await challengeResponse.json();

const message = new TextEncoder().encode(
  buildSolanaIssueMessage(challenge)
);

const signature = new Uint8Array(
  await crypto.subtle.sign("Ed25519", keys.privateKey, message)
);

const proof = {
  ...challenge,
  signature: Buffer.from(signature).toString("base64")
};

delete proof.expiresAt;

const issueResponse = await fetch("http://127.0.0.1:8788/issue", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(proof)
});

assert.equal(issueResponse.status, 200);
const grant = await issueResponse.json();
assert.match(grant.token, /^[a-f0-9]{64}$/);

console.log("grant issued");
const prematureComplete = await fetch("http://127.0.0.1:8788/complete", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${grant.token}`
  },
  body: JSON.stringify({
    path: "/metadata/image",
    sha256,
    cid: "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A"
  })
});

assert.notEqual(prematureComplete.status, 204);
console.log("completion before authorization blocked");


const authorizeResponse = await fetch("http://127.0.0.1:8788/authorize", {
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
});

assert.equal(authorizeResponse.status, 204);
console.log("grant authorized");

const authorizeReplay = await fetch("http://127.0.0.1:8788/authorize", {
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
});

assert.notEqual(authorizeReplay.status, 204);
console.log("authorization replay blocked");

const completeResponse = await fetch("http://127.0.0.1:8788/complete", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${grant.token}`
  },
  body: JSON.stringify({
    path: "/metadata/image",
    sha256,
    cid: "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A"
  })
});

assert.equal(completeResponse.status, 204);
console.log("upload completion recorded");

const completeReplay = await fetch("http://127.0.0.1:8788/complete", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${grant.token}`
  },
  body: JSON.stringify({
    path: "/metadata/image",
    sha256,
    cid: "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A"
  })
});

assert.notEqual(completeReplay.status, 204);
console.log("completion replay blocked");

console.log("FULL IMAGE GRANT LIFECYCLE PASSED");