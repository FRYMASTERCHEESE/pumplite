import assert from "node:assert/strict";
import { Wallet } from "ethers";
import {
  buildBaseIssueMessage,
  verifyBaseIssueSignature,
  normalizeBaseAddress
} from "./src/base-identity.js";

const wallet = Wallet.createRandom();

const payload = {
  subject: wallet.address,
  path: "/metadata/image",
  bytes: 1024,
  sha256: "a".repeat(64),
  imageCid: null,
  issuedAt: Date.now(),
  nonce: "b".repeat(32)
};

const message = buildBaseIssueMessage(payload);
const signature = await wallet.signMessage(message);

assert.equal(
  await verifyBaseIssueSignature({
    ...payload,
    signature
  }),
  true
);

assert.equal(
  await verifyBaseIssueSignature({
    ...payload,
    bytes: 1025,
    signature
  }),
  false
);

assert.equal(
  normalizeBaseAddress(wallet.address),
  wallet.address.toLowerCase()
);


assert.equal(
  await verifyBaseIssueSignature({
    ...payload,
    imageCid: "QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A",
    signature
  }),
  false,
  "Base imageCid tamper must invalidate signature"
);
console.log("Base identity tests passed");