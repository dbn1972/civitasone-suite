/**
 * Fastify plugin — verifies the Bearer token on every request and attaches
 * RequestContext to req.ctx. All services register this plugin once in app.ts.
 *
 * Public routes skip verification by setting:
 *   schema: { security: [] }   OR   opts.public = true on the route
 *
 * Usage in a service's app.ts:
 *   import { authPlugin } from "@civitasone/auth/plugin";
 *   await app.register(authPlugin);
 *
 * Then in any route handler:
 *   const ctx = req.ctx;  // RequestContext
 */

import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { verifyJwt, toRequestContext } from "./index.js";
import type { RequestContext } from "@civitasone/types";
import { randomUUID, timingSafeEqual } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

const PUBLIC_PATHS = new Set(["/health", "/ready", "/metrics"]);

/**
 * Boot-time security assertion: in production every service that relies on the
 * x-internal service-to-service path MUST have a non-empty INTERNAL_SERVICE_SECRET.
 * Without it the internal-call authentication degrades to "secret === ''" which an
 * attacker could trivially satisfy. We fail closed at startup instead. The value
 * is never logged. Outside production the check is skipped so local dev is unaffected.
 */
export function assertInternalServiceSecret(): void {
  if (process.env.NODE_ENV !== "production") return;
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(
      "INTERNAL_SERVICE_SECRET must be set in production; refusing to start.",
    );
  }
}

/**
 * Constant-time string comparison. Avoids the early-exit timing side channel of
 * `a !== b` when comparing secrets. The length is compared first (this leaks
 * only the length, which is standard for HMAC/secret comparison) and the bytes
 * are compared in constant time via timingSafeEqual.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const authPluginImpl: FastifyPluginAsync = async (fastify) => {
  assertInternalServiceSecret();
  fastify.decorateRequest("ctx", null);

  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const correlationId =
      ((req.headers["x-correlation-id"] as string | undefined) ?? randomUUID());

    if (PUBLIC_PATHS.has(req.url?.split("?")[0] ?? "")) {
      req.ctx = {
        tenantId: "",
        actorId: "system",
        actorType: "service_account",
        roles: [],
        correlationId,
        sessionId: "",
      };
      return;
    }

    // @ts-expect-error — Fastify route config
    if (req.routeOptions?.config?.public === true) {
      req.ctx = {
        tenantId: (req.query as { tenantId?: string })?.tenantId ?? "",
        actorId: "anonymous",
        actorType: "user",
        roles: [],
        correlationId,
        sessionId: "",
      };
      return;
    }

    const tenantHeader = req.headers["x-tenant-id"] as string | undefined;
    if (req.headers["x-internal"] === "1" && tenantHeader) {
      const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;
      const providedSecret = req.headers["x-service-secret"];
      // R12: fail closed unless the configured secret exists and the provided
      // value matches it in CONSTANT TIME (no early-exit timing oracle).
      if (
        typeof serviceSecret !== "string" ||
        serviceSecret.length === 0 ||
        typeof providedSecret !== "string" ||
        !constantTimeEqual(providedSecret, serviceSecret)
      ) {
        req.log.warn({ ip: req.ip }, "x-internal rejected: missing or invalid service secret");
        return reply.status(401).send({ error: "UNAUTHORIZED", message: "Bearer token required" });
      }

      const internalRoles = ["super_admin", "hr_admin", "payroll_admin", "finance_admin"];
      req.ctx = {
        tenantId: tenantHeader,
        actorId: "00000000-0000-0000-0000-000000000099",
        actorType: "service_account",
        roles: internalRoles,
        correlationId,
        sessionId: "",
      };
      // R12: audit every privilege elevation via the internal path so a leaked
      // secret leaves a trail. The secret itself is never logged.
      req.log.info(
        {
          event: "internal_service_elevation",
          tenantId: tenantHeader,
          path: req.url?.split("?")[0] ?? "",
          method: req.method,
          caller: (req.headers["x-internal-caller"] as string | undefined) ?? "unknown",
          ip: req.ip,
          correlationId,
        },
        "x-internal elevation granted",
      );
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "UNAUTHORIZED", message: "Bearer token required" });
    }

    const token = authHeader.slice(7);
    try {
      const payload = await verifyJwt(token);
      req.ctx = toRequestContext(
        payload,
        correlationId,
        (req.headers["x-tenant-id"] as string | undefined),
      );
    } catch (err) {
      req.log.warn({ err }, "JWT verification failed");
      return reply.status(401).send({ error: "UNAUTHORIZED", message: "Invalid or expired token" });
    }
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: "civitasone-auth",
  fastify: "4.x",
});
