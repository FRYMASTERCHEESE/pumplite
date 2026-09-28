const CONTROL_LIMIT = 2048;
const RESPONSE_LIMIT = 4096;
const encoder = new TextEncoder();

function reply(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function validCid(value) {
  return typeof value === "string" &&
    (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value) ||
     /^b[a-z2-7]{58}$/.test(value));
}

function validCommon(data) {
  return data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    (data.chain === "solana" || data.chain === "base") &&
    typeof data.subject === "string" &&
    data.subject.length > 0 &&
    data.subject.length <= 128 &&
    (data.path === "/metadata/image" || data.path === "/metadata/json") &&
    Number.isSafeInteger(data.bytes) &&
    data.bytes > 0 &&
    data.bytes <= 512 * 1024 &&
    typeof data.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(data.sha256);
}

function validChallenge(data) {
  if (!validCommon(data)) return false;

  if (
    data.path === "/metadata/image" &&
    data.imageCid !== null
  ) return false;

  if (
    data.path === "/metadata/json" &&
    !validCid(data.imageCid)
  ) return false;

  return Number.isSafeInteger(data.issuedAt) &&
    Number.isSafeInteger(data.expiresAt) &&
    data.expiresAt > data.issuedAt &&
    typeof data.nonce === "string" &&
    /^[0-9a-f]{32}$/.test(data.nonce);
}

function validIssue(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (data.chain !== "solana" && data.chain !== "base") ||
    (data.path !== "/metadata/image" && data.path !== "/metadata/json") ||
    !Number.isSafeInteger(data.bytes) ||
    data.bytes <= 0 ||
    data.bytes > (data.path === "/metadata/image" ? 512 * 1024 : 4096) ||
    typeof data.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(data.sha256)
  ) return false;

  if (
    data.path === "/metadata/image" &&
    data.imageCid !== null
  ) return false;

  if (
    data.path === "/metadata/json" &&
    !validCid(data.imageCid)
  ) return false;

  return typeof data.token === "string" &&
    /^[0-9a-f]{64}$/.test(data.token) &&
    Number.isSafeInteger(data.expiresAt);
}

async function readRequestBody(request) {
  const declared = Number(request.headers.get("Content-Length") || "0");

  if (
    Number.isFinite(declared) &&
    declared > CONTROL_LIMIT
  ) {
    throw Object.assign(new Error("too large"), { status: 413 });
  }

  const raw = await request.text();

  if (encoder.encode(raw).length > CONTROL_LIMIT) {
    throw Object.assign(new Error("too large"), { status: 413 });
  }

  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("invalid"), { status: 400 });
  }

  return raw;
}

async function readGuardResponse(response) {
  const declared = Number(response.headers.get("Content-Length") || "0");

  if (
    Number.isFinite(declared) &&
    declared > RESPONSE_LIMIT
  ) {
    throw new Error("response too large");
  }

  const raw = await response.text();

  if (encoder.encode(raw).length > RESPONSE_LIMIT) {
    throw new Error("response too large");
  }

  return JSON.parse(raw);
}

export async function metadataAuthRoute(
  request,
  env,
  path,
  corsHeaders
) {
  const headers = {
    ...corsHeaders,
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers
    });
  }

  if (request.method !== "POST") {
    return reply({ error: "Not found" }, 404, headers);
  }

  if (
    env.METADATA_AUTH_ENABLED !== "true" ||
    typeof env.UPLOAD_GUARD?.fetch !== "function"
  ) {
    return reply(
      { error: "Metadata authorization unavailable" },
      503,
      headers
    );
  }

  const contentType =
    (request.headers.get("Content-Type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

  if (contentType !== "application/json") {
    return reply(
      { error: "Content-Type must be application/json" },
      415,
      headers
    );
  }

  let raw;

  try {
    raw = await readRequestBody(request);
  } catch (error) {
    return reply(
      { error: "Invalid authorization request" },
      error?.status === 413 ? 413 : 400,
      headers
    );
  }

  const internalPath =
    path === "/metadata/challenge"
      ? "/challenge"
      : "/issue";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const upstream = await env.UPLOAD_GUARD.fetch(
      "https://upload-guard.internal" + internalPath,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: raw,
        signal: controller.signal
      }
    );

    const data = await readGuardResponse(upstream);

    if (!upstream.ok) {
      return reply(
        {
          error:
            upstream.status === 503
              ? "Metadata authorization unavailable"
              : "Metadata authorization rejected"
        },
        upstream.status,
        headers
      );
    }

    const valid =
      path === "/metadata/challenge"
        ? validChallenge(data)
        : validIssue(data);

    if (!valid) {
      return reply(
        { error: "Invalid authorization response" },
        502,
        headers
      );
    }

    return reply(data, 200, headers);
  } catch {
    return reply(
      { error: "Metadata authorization temporarily unavailable" },
      502,
      headers
    );
  } finally {
    clearTimeout(timer);
  }
}
