import {
  decodeBase58,
  decodeBase64
} from "./solana-identity.js";

const PROGRAM_ID =
  "3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku";

const PREFIX =
  "PumpLite Free Solana Launch\n" +
  "version=1\n";

const RESERVATION_PREFIX =
  "PumpLite First Buyer Reservation\n" +
  "version=1\n";

const PURCHASE_PREPARATION_PREFIX =
  "PumpLite Coin Purchase Preparation\n" +
  "version=1\n";

const RESERVATION_TTL_MS =
  300_000;

const enc =
  new TextEncoder();

const GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const PDA_MARKER =
  "ProgramDerivedAddress";

function encodeBase58(bytes) {
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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
      alphabet[digit] +
      body;

    number /= 58n;
  }

  return (
    "1".repeat(zeros) +
    body
  );
}

export async function
derivePumpLiteMarketAddress(
  mint
) {
  const mintBytes =
    decodeBase58(mint);

  const programBytes =
    decodeBase58(PROGRAM_ID);

  if (
    !mintBytes ||
    mintBytes.length !== 32 ||
    !programBytes ||
    programBytes.length !== 32
  ) {
    fail(
      "Invalid reservation mint"
    );
  }

  const seed =
    enc.encode("market");

  const marker =
    enc.encode(
      PDA_MARKER
    );

  const all =
    new Uint8Array(
      seed.length +
      mintBytes.length +
      1 +
      programBytes.length +
      marker.length
    );

  let offset = 0;

  all.set(
    seed,
    offset
  );
  offset += seed.length;

  all.set(
    mintBytes,
    offset
  );
  offset += mintBytes.length;

  all[offset] = 255;
  offset++;

  all.set(
    programBytes,
    offset
  );
  offset += programBytes.length;

  all.set(
    marker,
    offset
  );

  const digest =
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        all
      )
    );

  return encodeBase58(
    digest
  );
}

export const LAUNCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS solana_launches (
  id TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  uri TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  signature TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS solana_launches_registered
ON solana_launches(
  registered_at DESC
);

CREATE INDEX IF NOT EXISTS solana_launches_creator_registered
ON solana_launches(
  creator,
  registered_at DESC
);

CREATE TABLE IF NOT EXISTS solana_launch_reservations (
  launch_id TEXT PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL UNIQUE,
  buyer TEXT NOT NULL,
  nonce TEXT NOT NULL,
  signed_at INTEGER NOT NULL,
  reserved_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS
  solana_launch_reservations_expiry
ON solana_launch_reservations(
  expires_at
);

CREATE TABLE IF NOT EXISTS solana_launch_activations (
  launch_id TEXT PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL UNIQUE,
  buyer TEXT NOT NULL,
  transaction_signature TEXT NOT NULL UNIQUE,
  slot INTEGER NOT NULL,
  activated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS
  solana_launch_activations_time
ON solana_launch_activations(
  activated_at DESC
);
`;

function fail(
  message,
  status = 400
) {
  const error =
    new Error(message);

  error.status =
    status;

  throw error;
}

function one(cursor) {
  const rows =
    cursor.toArray();

  return rows.length
    ? rows[0]
    : null;
}

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json",

        "Cache-Control":
          "no-store"
      }
    }
  );
}

function utf8Length(value) {
  return enc.encode(value).length;
}

function validateUri(uri) {
  if (
    typeof uri !== "string" ||
    utf8Length(uri) > 200
  ) {
    fail(
      "Invalid launch URI"
    );
  }

  if (!uri) {
    return;
  }

  if (
    /[\s\\]/u.test(uri) ||
    /[\u0000-\u001f\u007f]/u
      .test(uri)
  ) {
    fail(
      "Invalid launch URI"
    );
  }

  let url;

  try {
    url =
      new URL(uri);
  } catch {
    fail(
      "Invalid launch URI"
    );
  }

  if (
    !["https:", "ipfs:"]
      .includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    !(
      uri.startsWith("https://") ||
      uri.startsWith("ipfs://")
    )
  ) {
    fail(
      "Invalid launch URI"
    );
  }
}

function canonicalRecord(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    fail(
      "Invalid launch"
    );
  }

  if (
    body.version !== 1 ||
    body.chain !== "solana" ||
    body.programId !== PROGRAM_ID
  ) {
    fail(
      "Unsupported PumpLite launch"
    );
  }

  const creator =
    typeof body.creator === "string"
      ? decodeBase58(body.creator)
      : null;

  if (
    !creator ||
    creator.length !== 32
  ) {
    fail(
      "Invalid creator"
    );
  }

  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    utf8Length(body.name) > 32
  ) {
    fail(
      "Invalid launch name"
    );
  }

  if (
    typeof body.symbol !== "string" ||
    !/^[A-Z0-9]{1,10}$/
      .test(body.symbol)
  ) {
    fail(
      "Invalid launch symbol"
    );
  }

  validateUri(
    body.uri
  );

  if (
    typeof body.nonce !== "string" ||
    !/^[0-9a-f]{32}$/
      .test(body.nonce)
  ) {
    fail(
      "Invalid launch nonce"
    );
  }

  if (
    !Number.isSafeInteger(
      body.createdAt
    ) ||
    body.createdAt <= 0
  ) {
    fail(
      "Invalid launch timestamp"
    );
  }

  return {
    version: 1,
    chain: "solana",
    programId: PROGRAM_ID,
    creator: body.creator,
    name: body.name,
    symbol: body.symbol,
    uri: body.uri,
    nonce: body.nonce,
    createdAt: body.createdAt
  };
}

function hex(bytes) {
  return Array.from(
    bytes,
    byte =>
      byte
        .toString(16)
        .padStart(2, "0")
  ).join("");
}

export async function
validateSignedLaunch(
  body,
  now = Date.now()
) {
  const record =
    canonicalRecord(body);

  if (
    record.createdAt <
      now - 86_400_000 ||
    record.createdAt >
      now + 300_000
  ) {
    fail(
      "Launch signature has expired"
    );
  }

  const canonical =
    JSON.stringify(record);

  const message =
    PREFIX +
    canonical;

  if (
    body.message !==
    message
  ) {
    fail(
      "Launch message mismatch"
    );
  }

  const digest =
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        enc.encode(canonical)
      )
    );

  const id =
    hex(digest);

  if (
    typeof body.id !== "string" ||
    body.id !== id
  ) {
    fail(
      "Launch ID mismatch"
    );
  }

  const publicKey =
    decodeBase58(
      record.creator
    );

  const signature =
    decodeBase64(
      body.signature
    );

  if (
    !publicKey ||
    publicKey.length !== 32 ||
    !signature ||
    signature.length !== 64
  ) {
    fail(
      "Invalid launch signature"
    );
  }

  let key;

  try {
    key =
      await crypto.subtle
        .importKey(
          "raw",
          publicKey,
          {
            name: "Ed25519"
          },
          false,
          ["verify"]
        );
  } catch {
    fail(
      "Invalid creator key"
    );
  }

  const valid =
    await crypto.subtle.verify(
      {
        name: "Ed25519"
      },
      key,
      signature,
      enc.encode(message)
    );

  if (!valid) {
    fail(
      "Launch signature verification failed",
      403
    );
  }

  return {
    ...record,
    id,
    message,
    signature:
      body.signature
  };
}

export async function
validateBuyerReservation(
  body,
  now = Date.now()
) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    fail(
      "Invalid reservation"
    );
  }

  const address = value => {
    if (
      typeof value !== "string"
    ) {
      return null;
    }

    const decoded =
      decodeBase58(value);

    return (
      decoded &&
      decoded.length === 32
    )
      ? value
      : null;
  };

  const record = {
    version:
      body.version,

    chain:
      body.chain,

    programId:
      body.programId,

    launchId:
      body.launchId,

    mint:
      body.mint,

    market:
      body.market,

    buyer:
      body.buyer,

    nonce:
      body.nonce,

    signedAt:
      body.signedAt
  };

  if (
    record.version !== 1 ||
    record.chain !== "solana" ||
    record.programId !== PROGRAM_ID ||
    typeof record.launchId !== "string" ||
    !/^[0-9a-f]{64}$/
      .test(record.launchId) ||
    !address(record.mint) ||
    !address(record.market) ||
    !address(record.buyer) ||
    typeof record.nonce !== "string" ||
    !/^[0-9a-f]{32}$/
      .test(record.nonce) ||
    !Number.isSafeInteger(
      record.signedAt
    )
  ) {
    fail(
      "Invalid reservation"
    );
  }

  const expectedMarket =
    await derivePumpLiteMarketAddress(
      record.mint
    );

  if (
    record.market !==
    expectedMarket
  ) {
    fail(
      "Reservation market mismatch"
    );
  }

  if (
    record.signedAt <
      now - 300_000 ||
    record.signedAt >
      now + 60_000
  ) {
    fail(
      "Reservation signature has expired"
    );
  }

  const canonical =
    JSON.stringify(record);

  const oldMessage =
    RESERVATION_PREFIX +
    canonical;

  const newMessage =
    PURCHASE_PREPARATION_PREFIX +
    canonical;

  const message =
    body.message === oldMessage ||
    body.message === newMessage
      ? body.message
      : "";

  if (!message) {
    fail(
      "Coin purchase preparation message mismatch"
    );
  }

  const publicKey =
    decodeBase58(
      record.buyer
    );

  const signature =
    decodeBase64(
      body.signature
    );

  if (
    !publicKey ||
    publicKey.length !== 32 ||
    !signature ||
    signature.length !== 64
  ) {
    fail(
      "Invalid reservation signature"
    );
  }

  let key;

  try {
    key =
      await crypto.subtle
        .importKey(
          "raw",
          publicKey,
          {
            name: "Ed25519"
          },
          false,
          ["verify"]
        );
  } catch {
    fail(
      "Invalid buyer key"
    );
  }

  const valid =
    await crypto.subtle.verify(
      {
        name: "Ed25519"
      },
      key,
      signature,
      enc.encode(message)
    );

  if (!valid) {
    fail(
      "Reservation signature verification failed",
      403
    );
  }

  return {
    ...record,
    message,
    signature:
      body.signature
  };
}

async function readBody(
  request
) {
  const declared =
    Number(
      request.headers
        .get("Content-Length") ||
      "0"
    );

  if (
    Number.isFinite(declared) &&
    declared > 4096
  ) {
    fail(
      "Launch request too large",
      413
    );
  }

  const raw =
    await request.text();

  if (
    enc.encode(raw).length >
      4096
  ) {
    fail(
      "Launch request too large",
      413
    );
  }

  try {
    return JSON.parse(raw);
  } catch {
    fail(
      "Invalid JSON"
    );
  }
}

function loadLaunch(
  sql,
  id
) {
  return one(
    sql.exec(
      `SELECT
         id,
         creator,
         name,
         symbol,
         uri,
         nonce,
         created_at,
         signature,
         registered_at,
         status
       FROM solana_launches
       WHERE id = ?`,
      id
    )
  );
}

function publicLaunch(row) {
  return {
    id:
      String(row.id),

    programId:
      PROGRAM_ID,

    creator:
      String(row.creator),

    name:
      String(row.name),

    symbol:
      String(row.symbol),

    uri:
      String(row.uri),

    nonce:
      String(row.nonce),

    createdAt:
      Number(row.created_at),

    signature:
      String(row.signature),

    registeredAt:
      Number(row.registered_at),

    status:
      String(row.status)
  };
}

function registerLaunch(
  ctx,
  launch,
  now
) {
  return ctx.storage
    .transactionSync(
      () => {
        const sql =
          ctx.storage.sql;

        const existing =
          loadLaunch(
            sql,
            launch.id
          );

        if (existing) {
          const same =
            existing.creator ===
              launch.creator &&
            existing.name ===
              launch.name &&
            existing.symbol ===
              launch.symbol &&
            existing.uri ===
              launch.uri &&
            existing.nonce ===
              launch.nonce &&
            Number(
              existing.created_at
            ) ===
              launch.createdAt &&
            existing.signature ===
              launch.signature;

          if (!same) {
            return {
              ok: false,
              conflict: true
            };
          }

          return {
            ok: true,
            launch:
              publicLaunch(
                existing
              )
          };
        }

        const dayStart =
          Math.floor(
            now / 86_400_000
          ) *
          86_400_000;

        const creatorCount =
          Number(
            one(
              sql.exec(
                `SELECT
                   COUNT(*) AS count
                 FROM solana_launches
                 WHERE creator = ?
                   AND registered_at >= ?`,
                launch.creator,
                dayStart
              )
            )?.count || 0
          );

        if (
          creatorCount >= 25
        ) {
          return {
            ok: false,
            limited: true
          };
        }

        const globalCount =
          Number(
            one(
              sql.exec(
                `SELECT
                   COUNT(*) AS count
                 FROM solana_launches
                 WHERE registered_at >= ?`,
                dayStart
              )
            )?.count || 0
          );

        if (
          globalCount >= 5000
        ) {
          return {
            ok: false,
            limited: true
          };
        }

        sql.exec(
          `INSERT INTO solana_launches
            (
              id,
              creator,
              name,
              symbol,
              uri,
              nonce,
              created_at,
              signature,
              registered_at,
              status
            )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          launch.id,
          launch.creator,
          launch.name,
          launch.symbol,
          launch.uri,
          launch.nonce,
          launch.createdAt,
          launch.signature,
          now
        );

        return {
          ok: true,
          launch:
            publicLaunch(
              loadLaunch(
                sql,
                launch.id
              )
            )
        };
      }
    );
}

function loadReservation(
  sql,
  launchId
) {
  return one(
    sql.exec(
      `SELECT
         launch_id,
         mint,
         market,
         buyer,
         nonce,
         signed_at,
         reserved_at,
         expires_at,
         signature,
         status
       FROM solana_launch_reservations
       WHERE launch_id = ?`,
      launchId
    )
  );
}

function publicReservation(
  row
) {
  return {
    launchId:
      String(
        row.launch_id
      ),

    mint:
      String(row.mint),

    market:
      String(row.market),

    buyer:
      String(row.buyer),

    signedAt:
      Number(
        row.signed_at
      ),

    reservedAt:
      Number(
        row.reserved_at
      ),

    expiresAt:
      Number(
        row.expires_at
      ),

    status:
      String(row.status)
  };
}

function reserveLaunch(
  ctx,
  reservation,
  now
) {
  return ctx.storage
    .transactionSync(
      () => {
        const sql =
          ctx.storage.sql;

        /*
         * Expired reservations no longer have any claim on their
         * public mint/market values. Remove them before enforcing
         * UNIQUE constraints.
         */
        sql.exec(
          `DELETE FROM solana_launch_reservations
           WHERE expires_at <= ?`,
          now
        );

        const launch =
          loadLaunch(
            sql,
            reservation.launchId
          );

        if (
          !launch ||
          launch.status !==
            "pending"
        ) {
          return {
            ok: false,
            missing: true
          };
        }

        const existing =
          loadReservation(
            sql,
            reservation.launchId
          );

        if (
          existing &&
          Number(
            existing.expires_at
          ) > now
        ) {
          const same =
            existing.mint ===
              reservation.mint &&
            existing.market ===
              reservation.market &&
            existing.buyer ===
              reservation.buyer;

          if (!same) {
            return {
              ok: false,
              conflict: true
            };
          }

          return {
            ok: true,
            reservation:
              publicReservation(
                existing
              )
          };
        }

        if (existing) {
          sql.exec(
            `DELETE FROM
               solana_launch_reservations
             WHERE launch_id = ?`,
            reservation.launchId
          );
        }

        const expiresAt =
          now +
          RESERVATION_TTL_MS;

        try {
          sql.exec(
            `INSERT INTO
               solana_launch_reservations
               (
                 launch_id,
                 mint,
                 market,
                 buyer,
                 nonce,
                 signed_at,
                 reserved_at,
                 expires_at,
                 signature,
                 status
               )
             VALUES
               (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved')`,
            reservation.launchId,
            reservation.mint,
            reservation.market,
            reservation.buyer,
            reservation.nonce,
            reservation.signedAt,
            now,
            expiresAt,
            reservation.signature
          );
        } catch {
          return {
            ok: false,
            conflict: true
          };
        }

        return {
          ok: true,
          reservation:
            publicReservation(
              loadReservation(
                sql,
                reservation.launchId
              )
            )
        };
      }
    );
}


function loadActivation(
  sql,
  launchId
) {
  return one(
    sql.exec(
      `SELECT
         launch_id,
         mint,
         market,
         buyer,
         transaction_signature,
         slot,
         activated_at
       FROM solana_launch_activations
       WHERE launch_id = ?`,
      launchId
    )
  );
}

function publicActivation(
  row
) {
  return {
    launchId:
      String(
        row.launch_id
      ),

    mint:
      String(row.mint),

    market:
      String(row.market),

    buyer:
      String(row.buyer),

    transactionSignature:
      String(
        row.transaction_signature
      ),

    slot:
      Number(row.slot),

    activatedAt:
      Number(
        row.activated_at
      )
  };
}

function validPublicKey(
  value
) {
  if (
    typeof value !==
      "string"
  ) {
    return false;
  }

  const bytes =
    decodeBase58(value);

  return Boolean(
    bytes &&
    bytes.length === 32
  );
}

function finalizeVerified(
  ctx,
  body,
  now
) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.version !== 1 ||
    body.chain !== "solana" ||
    body.programId !== PROGRAM_ID ||
    typeof body.launchId !== "string" ||
    !/^[0-9a-f]{64}$/
      .test(body.launchId) ||
    !validPublicKey(
      body.mint
    ) ||
    !validPublicKey(
      body.market
    ) ||
    !validPublicKey(
      body.buyer
    ) ||
    typeof body.transactionSignature !==
      "string" ||
    decodeBase58(
      body.transactionSignature
    )?.length !== 64 ||
    !Number.isSafeInteger(
      body.slot
    ) ||
    body.slot < 0
  ) {
    fail(
      "Invalid verified activation"
    );
  }

  return ctx.storage
    .transactionSync(
      () => {
        const sql =
          ctx.storage.sql;

        const launch =
          loadLaunch(
            sql,
            body.launchId
          );

        if (!launch) {
          return {
            missing: true
          };
        }

        const existing =
          loadActivation(
            sql,
            body.launchId
          );

        if (existing) {
          const same =
            existing.mint ===
              body.mint &&
            existing.market ===
              body.market &&
            existing.buyer ===
              body.buyer &&
            existing.transaction_signature ===
              body.transactionSignature;

          return same
            ? {
                ok: true,
                activation:
                  publicActivation(
                    existing
                  )
              }
            : {
                conflict: true
              };
        }

        if (
          launch.status !==
            "pending"
        ) {
          return {
            conflict: true
          };
        }

        const reservation =
          loadReservation(
            sql,
            body.launchId
          );

        if (
          !reservation ||
          reservation.mint !==
            body.mint ||
          reservation.market !==
            body.market ||
          reservation.buyer !==
            body.buyer
        ) {
          return {
            conflict: true
          };
        }

        try {
          sql.exec(
            `INSERT INTO
               solana_launch_activations
               (
                 launch_id,
                 mint,
                 market,
                 buyer,
                 transaction_signature,
                 slot,
                 activated_at
               )
             VALUES
               (?, ?, ?, ?, ?, ?, ?)`,
            body.launchId,
            body.mint,
            body.market,
            body.buyer,
            body.transactionSignature,
            body.slot,
            now
          );
        } catch {
          return {
            conflict: true
          };
        }

        sql.exec(
          `UPDATE solana_launches
           SET status = 'activated'
           WHERE id = ?`,
          body.launchId
        );

        sql.exec(
          `UPDATE solana_launch_reservations
           SET status = 'completed'
           WHERE launch_id = ?`,
          body.launchId
        );

        return {
          ok: true,
          activation:
            publicActivation(
              loadActivation(
                sql,
                body.launchId
              )
            )
        };
      }
    );
}

function parseActivatedOffset(
  pathname
) {
  const match =
    /^\/launch\/activated\/([0-9]+)\.json$/
      .exec(pathname);

  if (!match) {
    return null;
  }

  const offset =
    Number(match[1]);

  if (
    !Number.isSafeInteger(
      offset
    ) ||
    offset < 0 ||
    offset % 8 !== 0 ||
    offset > 100_000
  ) {
    return null;
  }

  return offset;
}

function activatedPage(
  ctx,
  offset
) {
  const sql =
    ctx.storage.sql;

  const rows =
    sql.exec(
      `SELECT
         a.launch_id,
         a.mint,
         a.market,
         a.slot,
         a.activated_at
       FROM solana_launch_activations a
       JOIN solana_launches l
         ON l.id = a.launch_id
       WHERE l.status = 'activated'
       ORDER BY
         a.activated_at DESC,
         a.launch_id ASC
       LIMIT 8 OFFSET ?`,
      offset
    ).toArray();

  const slotRow =
    one(
      sql.exec(
        `SELECT
           COALESCE(
             MAX(slot),
             0
           ) AS slot
         FROM solana_launch_activations`
      )
    );

  return {
    schemaVersion: 1,
    programId:
      PROGRAM_ID,

    genesisHash:
      GENESIS_HASH,

    slot:
      Number(
        slotRow?.slot || 0
      ),

    markets:
      rows.map(
        row =>
          String(row.mint)
      ),

    next:
      rows.length === 8
        ? offset + 8
        : null
  };
}

function finalizeContext(
  ctx,
  launchId
) {
  const sql =
    ctx.storage.sql;

  const launch =
    loadLaunch(
      sql,
      launchId
    );

  if (!launch) {
    return null;
  }

  const reservation =
    loadReservation(
      sql,
      launchId
    );

  const activation =
    loadActivation(
      sql,
      launchId
    );

  return {
    schemaVersion: 1,
    programId:
      PROGRAM_ID,

    launch:
      publicLaunch(
        launch
      ),

    reservation:
      reservation
        ? publicReservation(
            reservation
          )
        : null,

    activation:
      activation
        ? publicActivation(
            activation
          )
        : null
  };
}

function parseOffset(
  pathname
) {
  const match =
    /^\/launch\/pending\/([0-9]+)\.json$/
      .exec(pathname);

  if (!match) {
    return null;
  }

  const offset =
    Number(match[1]);

  if (
    !Number.isSafeInteger(
      offset
    ) ||
    offset < 0 ||
    offset % 8 !== 0 ||
    offset > 100_000
  ) {
    return null;
  }

  return offset;
}

function pendingPage(
  ctx,
  offset
) {
  const rows =
    ctx.storage.sql.exec(
      `SELECT
         id,
         creator,
         name,
         symbol,
         uri,
         nonce,
         created_at,
         signature,
         registered_at,
         status
       FROM solana_launches
       WHERE status = 'pending'
       ORDER BY registered_at DESC, id ASC
       LIMIT 8 OFFSET ?`,
      offset
    ).toArray();

  return {
    schemaVersion: 1,
    programId:
      PROGRAM_ID,

    launches:
      rows.map(
        publicLaunch
      ),

    next:
      rows.length === 8
        ? offset + 8
        : null
  };
}

export function isLaunchRoute(
  method,
  pathname
) {
  return Boolean(
    (
      method === "POST" &&
      (
        pathname ===
          "/launch/register" ||
        pathname ===
          "/launch/reserve" ||
        pathname ===
          "/launch/finalize-verified"
      )
    ) ||
    (
      method === "GET" &&
      /^\/launch\/pending\/[0-9]+\.json$/
        .test(pathname)
    ) ||
    (
      method === "GET" &&
      /^\/launch\/activated\/[0-9]+\.json$/
        .test(pathname)
    ) ||
    (
      method === "GET" &&
      /^\/launch\/finalize-context\/[0-9a-f]{64}\.json$/
        .test(pathname)
    ) ||
    (
      method === "GET" &&
      /^\/launch\/[0-9a-f]{64}\.json$/
        .test(pathname)
    )
  );
}

export async function
handleLaunchRequest(
  ctx,
  request,
  now = Date.now()
) {
  const url =
    new URL(
      request.url
    );

  if (
    request.method === "GET"
  ) {
    const activatedOffset =
      parseActivatedOffset(
        url.pathname
      );

    if (
      activatedOffset !==
        null
    ) {
      return json(
        activatedPage(
          ctx,
          activatedOffset
        )
      );
    }

    const contextMatch =
      /^\/launch\/finalize-context\/([0-9a-f]{64})\.json$/
        .exec(
          url.pathname
        );

    if (contextMatch) {
      const context =
        finalizeContext(
          ctx,
          contextMatch[1]
        );

      if (!context) {
        return json(
          {
            error:
              "Launch not found"
          },
          404
        );
      }

      return json(
        context
      );
    }
  }

  if (
    request.method === "POST" &&
    url.pathname ===
      "/launch/finalize-verified"
  ) {
    const result =
      finalizeVerified(
        ctx,
        await readBody(
          request
        ),
        now
      );

    if (result.missing) {
      return json(
        {
          error:
            "Launch not found"
        },
        404
      );
    }

    if (result.conflict) {
      return json(
        {
          error:
            "Activation conflicts with canonical PumpLite launch"
        },
        409
      );
    }

    return json({
      ok: true,
      activation:
        result.activation
    });
  }

  if (
    request.method === "POST" &&
    url.pathname ===
      "/launch/register"
  ) {
    const launch =
      await validateSignedLaunch(
        await readBody(
          request
        ),
        now
      );

    const result =
      registerLaunch(
        ctx,
        launch,
        now
      );

    if (result.conflict) {
      return json(
        {
          error:
            "Launch ID conflict"
        },
        409
      );
    }

    if (result.limited) {
      return json(
        {
          error:
            "Launch registration limit reached"
        },
        429
      );
    }

    return json({
      ok: true,
      id:
        result.launch.id,
      launch:
        result.launch
    });
  }

  if (
    request.method === "POST" &&
    url.pathname ===
      "/launch/reserve"
  ) {
    const reservation =
      await validateBuyerReservation(
        await readBody(
          request
        ),
        now
      );

    const result =
      reserveLaunch(
        ctx,
        reservation,
        now
      );

    if (result.missing) {
      return json(
        {
          error:
            "Pending launch not found"
        },
        404
      );
    }

    if (result.conflict) {
      return json(
        {
          error:
            "Launch already has an active buyer reservation"
        },
        409
      );
    }

    return json({
      ok: true,
      reservation:
        result.reservation
    });
  }

  if (
    request.method === "GET"
  ) {
    const offset =
      parseOffset(
        url.pathname
      );

    if (
      offset !== null
    ) {
      return json(
        pendingPage(
          ctx,
          offset
        )
      );
    }

    const match =
      /^\/launch\/([0-9a-f]{64})\.json$/
        .exec(
          url.pathname
        );

    if (match) {
      const row =
        loadLaunch(
          ctx.storage.sql,
          match[1]
        );

      if (!row) {
        return json(
          {
            error:
              "Launch not found"
          },
          404
        );
      }

      return json({
        schemaVersion: 1,
        programId:
          PROGRAM_ID,
        launch:
          publicLaunch(row)
      });
    }
  }

  return json(
    {
      error:
        "Not found"
    },
    404
  );
}
