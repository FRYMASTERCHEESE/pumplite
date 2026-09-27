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

const challengeResponse = await fetch("http://127.0.0.1:8788/challenge", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chain: "solana",
    subject,
    path: "/metadata/image",
    bytes: 1024,
    sha256: "a".repeat(64)
  })
});

assert.equal(challengeResponse.status, 200);

const challenge = await challengeResponse.json();

const message = new TextEncoder().encode(
  buildSolanaIssueMessage(challenge)
);

const signatureBytes = new Uint8Array(
  await crypto.subtle.sign("Ed25519", keys.privateKey, message)
);

const proof = {
  ...challenge,
  signature: Buffer.from(signatureBytes).toString("base64")
};

delete proof.expiresAt;

const issueResponse = await fetch("http://127.0.0.1:8788/issue", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(proof)
});

const issueBody = await issueResponse.json();

assert.equal(issueResponse.status, 200);
assert.match(issueBody.token, /^[a-f0-9]{64}$/);

console.log("valid signed grant issued");

const replayResponse = await fetch("http://127.0.0.1:8788/issue", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(proof)
});

assert.equal(replayResponse.status, 409);

console.log("replay correctly blocked");
console.log("SIGNED ISSUE FLOW PASSED");