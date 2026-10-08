import { handleMayhemRequest } from './mayhem.js';
import { DurableObject } from "cloudflare:workers";
import { SCHEMA } from "./schema.js";
import {
  POLICY,
  utcDay,
  validSubject,
  validUploadPath,
  maxBytesForPath,
  validSha256,
  validCid,
  sha256Hex
} from "./policy.js";
import { parseBearer, newGrantToken, hashGrantToken } from "./grants.js";
import { readJson } from "./request.js";
import { quotaDecision } from "./quota.js";
import { validateAuthorizeRequest } from "./authorize.js";
import { validateComplete } from "./complete.js";
import { handleChallenge } from "./challenge.js";
import { handleIssue } from "./issue-handler.js";
import {
  loadGrant,
  loadUsage,
  loadOwnedImage,
  reserveGrant,
  completeGrant
} from "./store.js";

import {
  LAUNCH_SCHEMA,
  isLaunchRoute,
  handleLaunchRequest
} from "./launches.js";

const ALLOWED_PATHS = new Set(["/challenge", "/issue", "/authorize", "/complete"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const launch =
      isLaunchRoute(
        request.method,
        url.pathname
      );

    if (
      !url.pathname.startsWith("/mayhem/") &&
      !launch &&
      (
        request.method !== "POST" ||
        !ALLOWED_PATHS.has(
          url.pathname
        )
      )
    ) {
      return json({ error: "Not found" }, 404);
    }

    if (!env.GUARD_STATE) {
      return json({ error: "Guard unavailable" }, 503);
    }

    const stub = env.GUARD_STATE.getByName("global");
    return stub.fetch(request);
  }
};

export class UploadGuard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(SCHEMA);
      ctx.storage.sql.exec(
        LAUNCH_SCHEMA
      );
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (
      url.pathname.startsWith('/mayhem/')
    ) {
      return handleMayhemRequest(
        this.ctx,
        request,
        this.env
      );
    }

    if (
      isLaunchRoute(
        request.method,
        url.pathname
      )
    ) {
      try {
        return await handleLaunchRequest(
          this.ctx,
          request,
          Date.now(),
          this.env
        );
      } catch (error) {
        const status =
          Number.isSafeInteger(
            error?.status
          )
            ? error.status
            : 500;

        return json(
          {
            error:
              status === 500
                ? "Launch registry temporarily unavailable"
                : error.message
          },
          status
        );
      }
    }

    if (
      request.method !== "POST" ||
      !ALLOWED_PATHS.has(
        url.pathname
      )
    ) {
      return json({ error: "Not found" }, 404);
    }

    if (url.pathname === "/challenge") {
      try {
        return await handleChallenge(this.ctx, request);
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500;
        return json(
          { error: status === 500 ? "Challenge temporarily unavailable" : error.message },
          status
        );
      }
    }

    if (url.pathname === "/issue") {
      if (this.env.ISSUE_ENABLED !== "true") {
        return json({ error: "Grant issuance unavailable" }, 503);
      }

      try {
        return await handleIssue(this.ctx, request, Date.now(), this.env);
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500;
        return json(
          { error: status === 500 ? "Grant issuance temporarily unavailable" : error.message },
          status
        );
      }
    }

    const token = parseBearer(request.headers.get("Authorization"));
    if (!token) {
      return json({ error: "Upload authorization required" }, 401);
    }

    const tokenHash = await hashGrantToken(token);
    const sql = this.ctx.storage.sql;
    const now = Date.now();

    try {
      if (url.pathname === "/authorize") {
        const body = await readJson(request, POLICY.maxControlBodyBytes);
        const grant = loadGrant(sql, tokenHash);
        const usage = grant ? safeUsage(sql, grant.subject, utcDay(now)) : null;
        const ownedImage = grant && body.imageCid ? loadOwnedImage(sql, body.imageCid, grant.subject) : null;
        const v = validateAuthorizeRequest({ grant, body, now, usage, ownedImage });
        if (!v.allowed) return json({ error: "Upload not authorized" }, v.status);

        const reserved = reserveGrant(this.ctx, {
          tokenHash,
          subject: grant.subject,
          path: body.path,
          sha256: body.sha256,
          bytes: body.bytes,
          now,
          day: utcDay(now)
        });
        if (!reserved.ok) return json({ error: "Upload not authorized" }, 403);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }

      if (url.pathname === "/complete") {
        const body = await readJson(request, POLICY.maxControlBodyBytes);
        const grant = loadGrant(sql, tokenHash);
        const v = validateComplete({ grant, body, now });
        if (!v.ok) return json({ error: "Upload receipt rejected" }, v.status);

        const done = completeGrant(this.ctx, {
          tokenHash,
          path: body.path,
          sha256: body.sha256,
          cid: body.cid,
          now
        });
        if (!done.ok) return json({ error: "Upload receipt rejected" }, 403);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      const status = Number.isSafeInteger(error?.status) ? error.status : 500;
      return json({ error: status === 500 ? "Guard temporarily unavailable" : error.message }, status);
    }
  }
};

function safeUsage(sql, subject, day) {
  return loadUsage(sql, subject, day);
}
