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

const challengeResponse = await fetch(
  "http://127.0.0.1:8788/challenge",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chain: "solana",
      subject,
      path: "/metadata/image",
      bytes: 1024,
      sha256: "9".repeat(64)
    })
  }
);

assert.equal(challengeResponse.status, 200);

const challenge = await challengeResponse.json();

const message = new TextEncoder().encode(
  buildSolanaIssueMessage(challenge)
);

const signature = new Uint8Array(
  await crypto.subtle.sign(
    "Ed25519",
    keys.privateKey,
    message
  )
);

const proof = {
  ...challenge,
  signature: Buffer.from(signature).toString("base64")
};

delete proof.expiresAt;

const requests = Array.from({ length: 5 }, () =>
  fetch("http://127.0.0.1:8788/issue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proof)
  })
);

const responses = await Promise.all(requests);
const statuses = responses.map((r) => r.status);

console.log("statuses:", statuses.join(", "));

assert.equal(
  statuses.filter((s) => s === 200).length,
  1
);

assert.equal(
  statuses.filter((s) => s === 409).length,
  4
);

console.log("exactly one concurrent grant issued");
console.log("CONCURRENT ISSUE TEST PASSED");