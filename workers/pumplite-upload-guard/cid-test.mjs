import assert from "node:assert/strict";
import { validCid } from "./src/policy.js";

assert.equal(validCid("QmYwAPJzv5CZsnAzt8auVZRnGiHzH1R9g1k6i1dSQg7S2A"), true);
assert.equal(validCid("not-a-cid"), false);

console.log("CID tests passed");
