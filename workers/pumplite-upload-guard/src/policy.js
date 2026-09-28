export const POLICY = Object.freeze({
  grantTtlMs: 5 * 60 * 1000,
  issueSignatureTtlMs: 2 * 60 * 1000,
  maxImageBytes: 512 * 1024,
  maxJsonBytes: 4096,
  maxControlBodyBytes: 2048,
  maxSubjectLength: 128,
  perSubjectRequestsPerDay: 10,
  globalRequestsPerDay: 40,
  perSubjectBytesPerDay: 6 * 1024 * 1024,
  globalBytesPerDay: 24 * 1024 * 1024,
  maxActiveIssueChallenges: 100,
  maxActiveIssueChallengesPerSubject: 3
});

export function utcDay(ms = Date.now()) {
  return Math.floor(ms / 86400000);
}

export function validSubject(value) {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= POLICY.maxSubjectLength &&
    /^[A-Za-z0-9:_-]+$/.test(value);
}

export function validUploadPath(value) {
  return value === "/metadata/image" || value === "/metadata/json";
}

export function maxBytesForPath(path) {
  if (path === "/metadata/image") return POLICY.maxImageBytes;
  if (path === "/metadata/json") return POLICY.maxJsonBytes;
  return 0;
}

export function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function validCid(value) {
  return typeof value === "string" && (
    /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value) ||
    /^b[a-z2-7]{58}$/.test(value)
  );
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function validNonce(value) {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}