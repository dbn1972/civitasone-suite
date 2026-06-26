import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { randomUUID } from "node:crypto";
import { resolveRoute } from "./registry.js";

// x-internal is intentionally absent: external clients must never inject it.
// The gateway sets it itself only when it originates an internal service call.
const FORWARD_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "x-correlation-id",
  "x-device-id",
  "x-device-trust-token",
  "x-step-up-token",
  "x-tenant-id",
  "x-idempotency-key",
] as const;

// Actively strip these from every inbound request before forwarding, regardless of FORWARD_HEADERS.
const STRIP_HEADERS = ["x-internal", "x-internal-secret", "x-internal-caller", "x-service-secret"] as const;

/**
 * Routes that do NOT require a bearer token at the gateway.
 * SEC-3: sync/devices were REMOVED from this list — they carry tenant data and
 * must be authenticated at the edge. Only auth-bootstrap (identity login/refresh)
 * and the first-run installer remain public.
 */
const PUBLIC_PREFIXES = ["/api/identity", "/api/v1/install"];

async function proxyHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const pathname = req.url.split("?")[0] ?? "/";
  const resolved = resolveRoute(pathname);
  if (!resolved) {
    return reply.code(404).send({ code: "NOT_FOUND", message: "no upstream for path" });
  }

  // Enforce authentication for all non-public routes
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!isPublic) {
    const auth = req.headers["authorization"];
    if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
      return reply.code(401).send({ code: "UNAUTHENTICATED", message: "missing or invalid authorization header" });
    }
  }

  const { route, remainder: rawRemainder } = resolved;
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const remainder = rawRemainder === "/" ? "" : rawRemainder;
  const basePath = route.upstreamPath ?? route.prefix.replace(/^\/api/, "");
  const targetUrl = `${route.upstream}${basePath}${remainder}${query}`;

  const headers: Record<string, string> = {};
  for (const h of FORWARD_HEADERS) {
    const v = req.headers[h];
    if (typeof v === "string") headers[h] = v;
  }
  if (!headers["x-correlation-id"]) headers["x-correlation-id"] = req.id;

  // Defense-in-depth: ensure bypass headers never reach upstream regardless of FORWARD_HEADERS.
  for (const h of STRIP_HEADERS) {
    delete (headers as Record<string, string | undefined>)[h];
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit = { method: req.method, headers };
  if (hasBody) init.body = JSON.stringify(req.body ?? {});
  const upstream = await fetch(targetUrl, init);

  reply.code(upstream.status);
  const ct = upstream.headers.get("content-type");
  if (ct) reply.header("content-type", ct);
  return reply.send(await upstream.text());
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // SEC REM-10: hard cap on inbound body size. Prevents memory-exhaustion attacks
    // via large-body requests at 1000 TPS. Default 1MB; tune via GATEWAY_BODY_LIMIT env.
    bodyLimit: Number(process.env.GATEWAY_BODY_LIMIT_BYTES ?? 1_048_576), // 1 MB
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  // SEC: CORS must fail closed in production. If CORS_ORIGIN is unset in prod we
  // refuse to start rather than silently trusting localhost. Outside prod we keep
  // the localhost dev default so local development is unaffected.
  const corsOriginEnv = process.env.CORS_ORIGIN;
  if (process.env.NODE_ENV === "production" && (!corsOriginEnv || corsOriginEnv.trim() === "")) {
    throw new Error(
      "CORS_ORIGIN must be set in production; refusing to start with an insecure default.",
    );
  }
  await app.register(cors, {
    origin: (corsOriginEnv ?? "http://localhost:3000").split(","),
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-correlation-id", "x-device-id", "x-device-trust-token", "x-step-up-token"],
  });

  // SEC: real CSP instead of disabling it. default-src 'self'; no unsafe-eval.
  // 'unsafe-inline' is permitted for styles only (Next.js injects inline <style>
  // tags and style attributes); scripts stay strict (no unsafe-inline / unsafe-eval).
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.GATEWAY_RATE_LIMIT_MAX ?? 1000),
    timeWindow: process.env.GATEWAY_RATE_LIMIT_WINDOW ?? "1 minute",
  });

  // SC-5: Per-tenant rate limit (second tier, registered after the global one).
  // keyGenerator identifies the tenant from x-tenant-id header; falls back to
  // req.ip for unauthenticated / no-tenant traffic so they stay under the global
  // 1 000 req/min limit rather than getting an extra 200/min allowance.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => (req.headers["x-tenant-id"] as string) || (req.ip ?? "unknown"),
    max: Number(process.env.GATEWAY_RATE_LIMIT_TENANT_MAX ?? 200),
    timeWindow: "1 minute",
  });

  registerOpsRoutes(app, {
    service: "gateway-service",
    checks: {
      custom: [
        {
          name: "identity",
          ping: async () => {
            try {
              const res = await fetch(process.env.IDENTITY_HEALTH_URL ?? "http://127.0.0.1:3001/health", { signal: AbortSignal.timeout(3000) });
              return res.ok;
            } catch { return false; }
          },
        },
        {
          name: "finance",
          ping: async () => {
            try {
              const res = await fetch(process.env.FINANCE_HEALTH_URL ?? "http://127.0.0.1:3007/health", { signal: AbortSignal.timeout(3000) });
              return res.ok;
            } catch { return false; }
          },
        },
        {
          name: "queue_upstream",
          ping: async () => {
            try {
              const res = await fetch(process.env.QUEUE_HEALTH_URL ?? "http://127.0.0.1:3019/health", { signal: AbortSignal.timeout(3000) });
              return res.ok;
            } catch { return false; }
          },
        },
      ],
    },
  });

  // 09-T2: /metrics is now guarded centrally inside registerOpsRoutes (token or
  // internal-IP), so the gateway no longer needs its own duplicate onRequest
  // guard. Behavior is identical — same METRICS_TOKEN / internal-IP rule.

  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // SEC REM-08: Per-IP auth rate limit (10 req/min). Primary brute-force defense is
  // Keycloak's built-in bruteForceProtected=true (failureFactor:5, lockout after 5
  // consecutive failures per username). This IP-based limit is the gateway secondary.
  // For distributed credential stuffing, consider adding per-username Redis counters
  // or integrating with Keycloak's events API for cross-IP username-based locking.
  //
  // keyGenerator: uses sanitized username from the request body when present so that
  // credential-stuffing attempts targeting the same username from many IPs are also
  // throttled. Falls back to req.ip for requests without a body (e.g. GET /token/refresh).
  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/api/identity/*",
    config: {
      rateLimit: {
        max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
        timeWindow: process.env.AUTH_RATE_LIMIT_WINDOW ?? "1 minute",
        // SEC REM-08: key by username (from body) when present, else IP. This
        // prevents distributed attacks where the same username is tried from many IPs.
        keyGenerator: (req) => {
          const body = req.body as Record<string, unknown> | undefined;
          const username = typeof body?.username === "string" ? body.username.toLowerCase().trim() : null;
          return username ? `auth:${username}` : (req.ip ?? "unknown");
        },
      },
    },
    handler: proxyHandler,
  });

  app.route({ method: ["GET", "POST", "PUT", "PATCH", "DELETE"], url: "/api/*", handler: proxyHandler });

  registerSchemaErrorHandler(app);

  return app;
}
