import assert from "node:assert/strict";
import {
  buildSolanaIssueMessage,
  verifySolanaIssueSignature
} from "./src/solana-identity.js";

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
  return "1".repeat(zeros) + (out || "");
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
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

const payload = {
  subject,
  path: "/metadata/image",
  bytes: 1024,
  sha256: "a".repeat(64),
  issuedAt: Date.now(),
  nonce: "b".repeat(32)
};

const message = new TextEncoder().encode(
  buildSolanaIssueMessage(payload)
);

const signature = new Uint8Array(
  await crypto.subtle.sign("Ed25519", keys.privateKey, message)
);

assert.equal(
  await verifySolanaIssueSignature({
    ...payload,
    signature: toBase64(signature)
  }),
  true
);

assert.equal(
  await verifySolanaIssueSignature({
    ...payload,
    bytes: 1025,
    signature: toBase64(signature)
  }),
  false
);


assert.equal(
  await verifySolanaIssueSignature({
    ...payload,
    imageCid: "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A",
    signature: toBase64(signature)
  }),
  false,
  "imageCid tamper must invalidate signature"
);
console.log("Solana identity tests passed");