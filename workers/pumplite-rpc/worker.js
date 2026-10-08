import { metadataRoute } from './metadata.js';
import { metadataAuthRoute } from './metadata-auth.js';
const ALLOWED_ORIGIN = "https://frymastercheese.github.io";

const PROGRAM_ID =
  "3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku";

const GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const TREASURY =
  "BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct";

const SYSTEM_PROGRAM =
  "11111111111111111111111111111111";

const TOKEN_PROGRAM =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const METADATA_PROGRAM =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

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
  "simulateTransaction",
  "sendTransaction"
]);

const MAX_BODY_BYTES = 100_000;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, solana-client",
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

async function launchProxy(
  request,
  env,
  origin
) {
  if (!env.UPLOAD_GUARD) {
    return jsonResponse(
      {
        error:
          "Launch registry unavailable"
      },
      503,
      origin || ALLOWED_ORIGIN
    );
  }

  const upstream =
    await env.UPLOAD_GUARD
      .fetch(request);

  const headers =
    new Headers(
      upstream.headers
    );

  for (
    const [
      key,
      value
    ] of Object.entries(
      corsHeaders(
        origin ||
        ALLOWED_ORIGIN
      )
    )
  ) {
    headers.set(
      key,
      value
    );
  }

  headers.set(
    "Cache-Control",
    "no-store"
  );

  return new Response(
    upstream.body,
    {
      status:
        upstream.status,
      headers
    }
  );
}


const B58 =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function rpcFail(
  message,
  status = 400
) {
  const error =
    new Error(message);

  error.status =
    status;

  throw error;
}

function decode58(
  value
) {
  if (
    typeof value !==
      "string" ||
    !value
  ) {
    return null;
  }

  let zeros = 0;

  while (
    zeros < value.length &&
    value[zeros] === "1"
  ) {
    zeros++;
  }

  let number = 0n;

  for (
    let index = zeros;
    index < value.length;
    index++
  ) {
    const digit =
      B58.indexOf(
        value[index]
      );

    if (digit < 0) {
      return null;
    }

    number =
      number * 58n +
      BigInt(digit);
  }

  const body = [];

  while (number > 0n) {
    body.push(
      Number(
        number & 255n
      )
    );

    number >>= 8n;
  }

  body.reverse();

  const out =
    new Uint8Array(
      zeros +
      body.length
    );

  out.set(
    body,
    zeros
  );

  return out;
}

function encode58(
  bytes
) {
  let zeros = 0;

  while (
    zeros < bytes.length &&
    bytes[zeros] === 0
  ) {
    zeros++;
  }

  let number = 0n;

  for (const byte of bytes) {
    number =
      number * 256n +
      BigInt(byte);
  }

  let body = "";

  while (number > 0n) {
    const digit =
      Number(
        number % 58n
      );

    body =
      B58[digit] +
      body;

    number /= 58n;
  }

  return (
    "1".repeat(zeros) +
    body
  );
}

function base64Bytes(
  value
) {
  const binary =
    atob(value);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let index = 0;
    index < binary.length;
    index++
  ) {
    bytes[index] =
      binary.charCodeAt(
        index
      );
  }

  return bytes;
}

function readU64LE(
  bytes,
  start
) {
  if (
    start < 0 ||
    start + 8 >
      bytes.length
  ) {
    rpcFail(
      "Invalid PumpLite instruction"
    );
  }

  let value = 0n;

  for (
    let index = 7;
    index >= 0;
    index--
  ) {
    value =
      value * 256n +
      BigInt(
        bytes[
          start + index
        ]
      );
  }

  return value;
}

function instructionProgram(
  instruction
) {
  return typeof instruction
    ?.programId === "string"
      ? instruction.programId
      : "";
}

function instructionAccounts(
  instruction
) {
  if (
    !Array.isArray(
      instruction?.accounts
    )
  ) {
    return [];
  }

  return instruction.accounts
    .map(
      account =>
        typeof account ===
          "string"
          ? account
          : typeof account?.pubkey ===
              "string"
            ? account.pubkey
            : ""
    );
}

function parseMetadataAccount(
  value
) {
  if (
    !value ||
    value.owner !==
      METADATA_PROGRAM ||
    !Array.isArray(
      value.data
    ) ||
    typeof value.data[0] !==
      "string"
  ) {
    rpcFail(
      "Invalid PumpLite metadata account",
      409
    );
  }

  const bytes =
    base64Bytes(
      value.data[0]
    );

  if (
    bytes.length < 69
  ) {
    rpcFail(
      "PumpLite metadata account is truncated",
      409
    );
  }

  let offset = 1;

  const updateAuthority =
    encode58(
      bytes.slice(
        offset,
        offset + 32
      )
    );

  offset += 32;

  const mint =
    encode58(
      bytes.slice(
        offset,
        offset + 32
      )
    );

  offset += 32;

  const decoder =
    new TextDecoder(
      "utf-8",
      {
        fatal: true
      }
    );

  const readString = () => {
    if (
      offset + 4 >
      bytes.length
    ) {
      rpcFail(
        "Invalid PumpLite metadata string",
        409
      );
    }

    const view =
      new DataView(
        bytes.buffer,
        bytes.byteOffset +
          offset,
        4
      );

    const length =
      view.getUint32(
        0,
        true
      );

    offset += 4;

    if (
      length > 512 ||
      offset + length >
        bytes.length
    ) {
      rpcFail(
        "Invalid PumpLite metadata length",
        409
      );
    }

    let text;

    try {
      text =
        decoder.decode(
          bytes.slice(
            offset,
            offset + length
          )
        );
    } catch {
      rpcFail(
        "Invalid PumpLite metadata UTF-8",
        409
      );
    }

    offset += length;

    return text.replace(
      /\u0000+$/g,
      ""
    );
  };

  return {
    updateAuthority,
    mint,
    name:
      readString(),
    symbol:
      readString(),
    uri:
      readString()
  };
}

async function upstreamRpc(
  env,
  method,
  params
) {
  if (!env.HELIUS_RPC_URL) {
    rpcFail(
      "RPC service unavailable",
      503
    );
  }

  let response;

  try {
    response =
      await fetch(
        env.HELIUS_RPC_URL,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method,
              params
            })
        }
      );
  } catch {
    rpcFail(
      "RPC service temporarily unavailable",
      502
    );
  }

  if (!response.ok) {
    rpcFail(
      "RPC service temporarily unavailable",
      502
    );
  }

  const text =
    await response.text();

  if (
    text.length >
    2_000_000
  ) {
    rpcFail(
      "RPC response too large",
      502
    );
  }

  let payload;

  try {
    payload =
      JSON.parse(text);
  } catch {
    rpcFail(
      "RPC service returned invalid JSON",
      502
    );
  }

  if (payload?.error) {
    rpcFail(
      "RPC verification failed",
      502
    );
  }

  return payload?.result;
}

async function guardJson(
  env,
  pathname,
  init = {}
) {
  if (!env.UPLOAD_GUARD) {
    rpcFail(
      "Launch registry unavailable",
      503
    );
  }

  const response =
    await env.UPLOAD_GUARD
      .fetch(
        new Request(
          "https://pumplite.internal" +
          pathname,
          init
        )
      );

  const text =
    await response.text();

  let payload;

  try {
    payload =
      JSON.parse(text);
  } catch {
    rpcFail(
      "Launch registry returned invalid JSON",
      502
    );
  }

  return {
    ok:
      response.ok,
    status:
      response.status,
    payload
  };
}

async function readSmallJson(
  request
) {
  const declared =
    Number(
      request.headers.get(
        "Content-Length"
      ) || "0"
    );

  if (
    Number.isFinite(
      declared
    ) &&
    declared > 4096
  ) {
    rpcFail(
      "Request too large",
      413
    );
  }

  const raw =
    await request.text();

  if (
    new TextEncoder()
      .encode(raw)
      .length >
      4096
  ) {
    rpcFail(
      "Request too large",
      413
    );
  }

  try {
    return JSON.parse(raw);
  } catch {
    rpcFail(
      "Invalid JSON"
    );
  }
}

async function finalizeLaunch(
  request,
  env,
  origin
) {
  const body =
    await readSmallJson(
      request
    );

  if (
    !body ||
    typeof body !==
      "object" ||
    Array.isArray(body) ||
    typeof body.launchId !==
      "string" ||
    !/^[0-9a-f]{64}$/
      .test(body.launchId) ||
    typeof body.signature !==
      "string" ||
    decode58(
      body.signature
    )?.length !== 64
  ) {
    rpcFail(
      "Invalid activation finalization"
    );
  }

  const contextReply =
    await guardJson(
      env,
      "/launch/finalize-context/" +
      body.launchId +
      ".json"
    );

  if (
    !contextReply.ok
  ) {
    rpcFail(
      contextReply.payload
        ?.error ||
        "Launch not found",
      contextReply.status === 404
        ? 404
        : 502
    );
  }

  const context =
    contextReply.payload;

  if (
    context?.schemaVersion !==
      1 ||
    context?.programId !==
      PROGRAM_ID
  ) {
    rpcFail(
      "Invalid PumpLite launch context",
      409
    );
  }

  if (
    context.activation
  ) {
    if (
      context.activation
        .transactionSignature ===
      body.signature
    ) {
      return jsonResponse(
        {
          ok: true,
          activation:
            context.activation
        },
        200,
        origin
      );
    }

    rpcFail(
      "PumpLite launch is already activated",
      409
    );
  }

  const launch =
    context.launch;

  const reservation =
    context.reservation;

  if (
    !launch ||
    launch.status !==
      "pending" ||
    !reservation ||
    reservation.status !==
      "reserved"
  ) {
    rpcFail(
      "Canonical pending reservation not found",
      409
    );
  }

  const statusResult =
    await upstreamRpc(
      env,
      "getSignatureStatuses",
      [
        [
          body.signature
        ],
        {
          searchTransactionHistory:
            true
        }
      ]
    );

  const signatureStatus =
    statusResult
      ?.value?.[0];

  if (
    !signatureStatus ||
    signatureStatus.err !==
      null ||
    ![
      "confirmed",
      "finalized"
    ].includes(
      signatureStatus
        .confirmationStatus
    )
  ) {
    rpcFail(
      "Activation transaction is not confirmed successfully",
      409
    );
  }

  const transaction =
    await upstreamRpc(
      env,
      "getTransaction",
      [
        body.signature,
        {
          encoding:
            "jsonParsed",
          commitment:
            "confirmed",
          maxSupportedTransactionVersion:
            0
        }
      ]
    );

  if (
    !transaction ||
    transaction.meta?.err !==
      null ||
    !Number.isSafeInteger(
      transaction.slot
    ) ||
    transaction.slot < 0 ||
    transaction.transaction
      ?.signatures?.[0] !==
      body.signature
  ) {
    rpcFail(
      "Confirmed activation transaction is not yet independently readable",
      409
    );
  }

  const instructions =
    transaction.transaction
      ?.message
      ?.instructions;

  if (
    !Array.isArray(
      instructions
    )
  ) {
    rpcFail(
      "Activation transaction has no instructions",
      409
    );
  }

  const pumpInstruction =
    instructions.find(
      instruction =>
        instructionProgram(
          instruction
        ) ===
        PROGRAM_ID
    );

  const pumpAccounts =
    instructionAccounts(
      pumpInstruction
    );

  if (
    pumpAccounts.length < 7 ||
    pumpAccounts[0] !==
      reservation.buyer ||
    pumpAccounts[1] !==
      reservation.market ||
    pumpAccounts[2] !==
      reservation.mint ||
    pumpAccounts[4] !==
      TREASURY ||
    pumpAccounts[5] !==
      SYSTEM_PROGRAM ||
    pumpAccounts[6] !==
      TOKEN_PROGRAM
  ) {
    rpcFail(
      "Activation transaction does not match the reserved PumpLite market",
      409
    );
  }

  const pumpData =
    decode58(
      pumpInstruction
        ?.data
    );

  if (
    !pumpData ||
    pumpData.length !== 17 ||
    pumpData[0] !== 0 ||
    readU64LE(
      pumpData,
      1
    ) <= 0n ||
    readU64LE(
      pumpData,
      9
    ) <= 0n
  ) {
    rpcFail(
      "Activation transaction does not contain a valid first buy",
      409
    );
  }

  const metadataInstruction =
    instructions.find(
      instruction =>
        instructionProgram(
          instruction
        ) ===
        METADATA_PROGRAM
    );

  const metadataAccounts =
    instructionAccounts(
      metadataInstruction
    );

  if (
    metadataAccounts.length < 6 ||
    metadataAccounts[1] !==
      reservation.mint ||
    metadataAccounts[2] !==
      reservation.buyer ||
    metadataAccounts[3] !==
      reservation.buyer ||
    metadataAccounts[4] !==
      launch.creator ||
    metadataAccounts[5] !==
      SYSTEM_PROGRAM
  ) {
    rpcFail(
      "Activation metadata authority does not match the creator",
      409
    );
  }

  const mintResult =
    await upstreamRpc(
      env,
      "getAccountInfo",
      [
        reservation.mint,
        {
          encoding:
            "jsonParsed",
          commitment:
            "confirmed"
        }
      ]
    );

  const mintValue =
    mintResult?.value;

  const mintInfo =
    mintValue
      ?.data
      ?.parsed
      ?.info;

  if (
    !mintValue ||
    mintValue.owner !==
      TOKEN_PROGRAM ||
    mintInfo?.decimals !== 6 ||
    mintInfo?.isInitialized !==
      true ||
    mintInfo?.mintAuthority !==
      reservation.market ||
    mintInfo?.freezeAuthority !==
      null ||
    typeof mintInfo?.supply !==
      "string" ||
    BigInt(
      mintInfo.supply
    ) <= 0n
  ) {
    rpcFail(
      "On-chain PumpLite mint state failed verification",
      409
    );
  }

  const marketResult =
    await upstreamRpc(
      env,
      "getAccountInfo",
      [
        reservation.market,
        {
          encoding:
            "base64",
          commitment:
            "confirmed"
        }
      ]
    );

  const marketValue =
    marketResult?.value;

  if (
    !marketValue ||
    marketValue.owner !==
      SYSTEM_PROGRAM ||
    !Number.isSafeInteger(
      marketValue.lamports
    ) ||
    marketValue.lamports <= 0 ||
    !Array.isArray(
      marketValue.data
    ) ||
    typeof marketValue.data[0] !==
      "string" ||
    base64Bytes(
      marketValue.data[0]
    ).length !== 0
  ) {
    rpcFail(
      "On-chain PumpLite market state failed verification",
      409
    );
  }

  const buyerTokens =
    await upstreamRpc(
      env,
      "getTokenAccountsByOwner",
      [
        reservation.buyer,
        {
          mint:
            reservation.mint
        },
        {
          encoding:
            "jsonParsed",
          commitment:
            "confirmed"
        }
      ]
    );

  const buyerToken =
    Array.isArray(
      buyerTokens?.value
    )
      ? buyerTokens.value.find(
          account =>
            account?.pubkey ===
              pumpAccounts[3] &&
            account?.account
              ?.data
              ?.parsed
              ?.info
              ?.owner ===
                reservation.buyer &&
            account?.account
              ?.data
              ?.parsed
              ?.info
              ?.mint ===
                reservation.mint &&
            BigInt(
              account?.account
                ?.data
                ?.parsed
                ?.info
                ?.tokenAmount
                ?.amount ||
              "0"
            ) > 0n
        )
      : null;

  if (!buyerToken) {
    rpcFail(
      "First buyer did not receive PumpLite tokens",
      409
    );
  }

  const metadataResult =
    await upstreamRpc(
      env,
      "getAccountInfo",
      [
        metadataAccounts[0],
        {
          encoding:
            "base64",
          commitment:
            "confirmed"
        }
      ]
    );

  const metadata =
    parseMetadataAccount(
      metadataResult?.value
    );

  if (
    metadata.updateAuthority !==
      launch.creator ||
    metadata.mint !==
      reservation.mint ||
    metadata.name !==
      launch.name ||
    metadata.symbol !==
      launch.symbol ||
    metadata.uri !==
      launch.uri
  ) {
    rpcFail(
      "On-chain token metadata does not match the signed PumpLite launch",
      409
    );
  }

  const verified =
    {
      version: 1,
      chain:
        "solana",
      programId:
        PROGRAM_ID,
      launchId:
        body.launchId,
      mint:
        reservation.mint,
      market:
        reservation.market,
      buyer:
        reservation.buyer,
      transactionSignature:
        body.signature,
      slot:
        transaction.slot
    };

  const finalized =
    await guardJson(
      env,
      "/launch/finalize-verified",
      {
        method:
          "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(
            verified
          )
      }
    );

  if (
    !finalized.ok ||
    finalized.payload?.ok !==
      true
  ) {
    rpcFail(
      finalized.payload
        ?.error ||
        "PumpLite activation could not be finalized",
      finalized.status === 409
        ? 409
        : 502
    );
  }

  return jsonResponse(
    {
      ok: true,
      activation:
        finalized.payload
          .activation
    },
    200,
    origin
  );
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

    const publicLaunchRead =
      request.method === "GET" &&
      (
        /^\/launch\/pending\/[0-9]+\.json$/
          .test(url.pathname) ||
        /^\/launch\/activated\/[0-9]+\.json$/
          .test(url.pathname) ||
        /^\/launch\/[0-9a-f]{64}\.json$/
          .test(url.pathname)
      );

    if (publicLaunchRead) {
      return launchProxy(
        request,
        env,
        origin
      );
    }

    // Only PumpLite's GitHub Pages origin may use signed/control APIs.
    if (origin !== ALLOWED_ORIGIN) {
      return jsonResponse(
        { error: "Origin not allowed" },
        403
      );
    }

    // Preserve route-specific headers after exact-origin enforcement.
    if (request.method === "OPTIONS") {
      const headers = corsHeaders(origin);
      if (["/metadata/image", "/metadata/json", "/metadata/challenge", "/metadata/issue"].includes(url.pathname)) {
        headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
      }
      return new Response(null, { status: 204, headers });
    }

    /*
     * Manual Mayhem is implemented by the private upload-guard
     * Durable Object. The public RPC Worker only proxies the
     * reviewed /mayhem/* API after enforcing PumpLite's origin.
     */
    if (
      url.pathname.startsWith(
        "/mayhem/"
      )
    ) {
      return launchProxy(
        request,
        env,
        origin
      );
    }

    if (
      request.method === "POST" &&
      url.pathname ===
        "/launch/finalize"
    ) {
      try {
        return await finalizeLaunch(
          request,
          env,
          origin
        );
      } catch (error) {
        const status =
          Number.isSafeInteger(
            error?.status
          )
            ? error.status
            : 500;

        return jsonResponse(
          {
            error:
              status === 500
                ? "Activation verification temporarily unavailable"
                : error.message
          },
          status,
          origin
        );
      }
    }

    if (
      request.method === "POST" &&
      (
        url.pathname ===
          "/launch/register" ||
        url.pathname ===
          "/launch/reserve"
      )
    ) {
      return launchProxy(
        request,
        env,
        origin
      );
    }

    // Version negotiation only; does not authorize an upload or contact upstream services.
    if (url.pathname === '/metadata/capabilities' && request.method === 'GET') {
      return jsonResponse({ version: 2, fields: ['links', 'banner'] }, 200, origin);
    }

    if (url.pathname === '/metadata/image' || url.pathname === '/metadata/json') {
      return metadataRoute(request, env, url.pathname, corsHeaders(origin));
    }

    if (url.pathname === '/metadata/challenge' || url.pathname === '/metadata/issue') {
      return metadataAuthRoute(request, env, url.pathname, corsHeaders(origin));
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

    /*
     * Signed transaction broadcasting is intentionally restricted.
     *
     * Only a normal-sized Solana transaction that contains BOTH:
     * - the deployed PumpLite program
     * - the PumpLite treasury
     *
     * may use this relay.
     *
     * This prevents the endpoint from becoming a generic public
     * Solana transaction broadcaster.
     */
    if (
      payload.method ===
        "sendTransaction"
    ) {
      if (
        !Array.isArray(
          payload.params
        ) ||
        typeof payload.params[0] !==
          "string" ||
        payload.params[0].length < 100 ||
        payload.params[0].length > 2000
      ) {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id:
              payload.id ?? null,
            error: {
              code: -32602,
              message:
                "Invalid PumpLite transaction"
            }
          },
          400,
          origin
        );
      }

      let transaction;

      try {
        const binary =
          atob(
            payload.params[0]
          );

        transaction =
          Uint8Array.from(
            binary,
            char =>
              char.charCodeAt(0)
          );
      } catch {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id:
              payload.id ?? null,
            error: {
              code: -32602,
              message:
                "Invalid PumpLite transaction encoding"
            }
          },
          400,
          origin
        );
      }

      if (
        transaction.length < 100 ||
        transaction.length > 1232
      ) {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id:
              payload.id ?? null,
            error: {
              code: -32602,
              message:
                "Invalid PumpLite transaction size"
            }
          },
          400,
          origin
        );
      }

      const contains =
        needle => {
          if (
            !needle ||
            needle.length !== 32
          ) {
            return false;
          }

          outer:
          for (
            let offset = 0;
            offset <=
              transaction.length -
                needle.length;
            offset++
          ) {
            for (
              let index = 0;
              index < needle.length;
              index++
            ) {
              if (
                transaction[
                  offset + index
                ] !==
                needle[index]
              ) {
                continue outer;
              }
            }

            return true;
          }

          return false;
        };

      const normalPumpLiteTransaction =
        contains(
          decode58(
            PROGRAM_ID
          )
        ) &&
        contains(
          decode58(
            TREASURY
          )
        );

      /*
       * Immediate mint creation happens before the PumpLite
       * program is invoked. Its reviewed transaction contains:
       *
       * - PumpLite creator/treasury wallet
       * - System Program
       * - SPL Token Program
       * - Metaplex Token Metadata Program
       *
       * The transaction is already fully signed before this
       * relay sees it, so the treasury signer must have approved it.
       */
      const reviewedMintCreation =
        contains(
          decode58(
            TREASURY
          )
        ) &&
        contains(
          decode58(
            SYSTEM_PROGRAM
          )
        ) &&
        contains(
          decode58(
            TOKEN_PROGRAM
          )
        ) &&
        contains(
          decode58(
            METADATA_PROGRAM
          )
        );

      if (
        !normalPumpLiteTransaction &&
        !reviewedMintCreation
      ) {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id:
              payload.id ?? null,
            error: {
              code: -32602,
              message:
                "Transaction is not a PumpLite transaction"
            }
          },
          403,
          origin
        );
      }
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
