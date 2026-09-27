import { metadataRoute } from './metadata.js';
import { metadataAuthRoute } from './metadata-auth.js';
const ALLOWED_ORIGIN = "https://frymastercheese.github.io";

const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getBlockTime",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenSupply",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "simulateTransaction"
]);

const MAX_BODY_BYTES = 100_000;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };
}

function jsonResponse(data, status, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin)
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // Health check - never exposes the Helius URL or API key.
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store"
        }
      });
    }

    // Only PumpLite's GitHub Pages origin may use /rpc.
    if (origin !== ALLOWED_ORIGIN) {
      return jsonResponse(
        { error: "Origin not allowed" },
        403
      );
    }

    if (url.pathname === '/metadata/image' || url.pathname === '/metadata/json') {
      return metadataRoute(request, env, url.pathname, corsHeaders(origin));
    }

    if (url.pathname === '/metadata/challenge' || url.pathname === '/metadata/issue') {
      return metadataAuthRoute(request, env, url.pathname, corsHeaders(origin));
    }
    // CORS preflight.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    // Only POST /rpc is supported.
    if (request.method !== "POST" || url.pathname !== "/rpc") {
      return jsonResponse(
        { error: "Not found" },
        404,
        origin
      );
    }

    const contentType =
      request.headers.get("Content-Type") || "";

    if (
      !contentType
        .toLowerCase()
        .includes("application/json")
    ) {
      return jsonResponse(
        { error: "Content-Type must be application/json" },
        415,
        origin
      );
    }

    const declaredLength = Number(
      request.headers.get("Content-Length") || "0"
    );

    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_BODY_BYTES
    ) {
      return jsonResponse(
        { error: "Request too large" },
        413,
        origin
      );
    }

    let raw;

    try {
      raw = await request.text();
    } catch {
      return jsonResponse(
        { error: "Unable to read request" },
        400,
        origin
      );
    }

    if (
      new TextEncoder().encode(raw).length >
      MAX_BODY_BYTES
    ) {
      return jsonResponse(
        { error: "Request too large" },
        413,
        origin
      );
    }

    let payload;

    try {
      payload = JSON.parse(raw);
    } catch {
      return jsonResponse(
        { error: "Invalid JSON" },
        400,
        origin
      );
    }

    // JSON-RPC batching remains disabled.
    if (
      !payload ||
      Array.isArray(payload) ||
      typeof payload !== "object"
    ) {
      return jsonResponse(
        { error: "JSON-RPC batching is disabled" },
        400,
        origin
      );
    }

    if (
      payload.jsonrpc !== "2.0" ||
      typeof payload.method !== "string"
    ) {
      return jsonResponse(
        { error: "Invalid JSON-RPC request" },
        400,
        origin
      );
    }

    if (!ALLOWED_METHODS.has(payload.method)) {
      return jsonResponse(
        {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: {
            code: -32601,
            message: "RPC method not allowed"
          }
        },
        403,
        origin
      );
    }

    if (!env.HELIUS_RPC_URL) {
      return jsonResponse(
        { error: "RPC service unavailable" },
        503,
        origin
      );
    }

    try {
      const upstream = await fetch(env.HELIUS_RPC_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: raw
      });
      if (!upstream.ok) {
        return jsonResponse({ error: 'RPC service temporarily unavailable' }, 502, origin);
      }
      const responseText = await upstream.text();
      return new Response(responseText, { status: 200, headers: {
        'Content-Type': 'application/json', ...corsHeaders(origin)
      } });
    } catch {
      return jsonResponse({ error: 'RPC service temporarily unavailable' }, 502, origin);
    }
  }
};
