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
import { randomUUID } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

const PUBLIC_PATHS = new Set(["/health", "/ready", "/metrics"]);

const authPluginImpl: FastifyPluginAsync = async (fastify) => {
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
      if (
        typeof serviceSecret !== "string" ||
        serviceSecret.length === 0 ||
        req.headers["x-service-secret"] !== serviceSecret
      ) {
        req.log.warn({ ip: req.ip }, "x-internal rejected: missing or invalid service secret");
        return reply.status(401).send({ error: "UNAUTHORIZED", message: "Bearer token required" });
      }

      req.ctx = {
        tenantId: tenantHeader,
        actorId: "00000000-0000-0000-0000-000000000099",
        actorType: "service_account",
        roles: ["super_admin", "hr_admin", "payroll_admin", "finance_admin"],
        correlationId,
        sessionId: "",
      };
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
