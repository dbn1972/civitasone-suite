import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { Readable } from "node:stream";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { quotaCheckPlugin } from "@civitasone/db";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { resolveRoute } from "./registry.js";
import { checkModuleEnabled } from "./module-guard.js";
import { checkPolicy } from "./policy-check.js";
import { createRedisQuotaStore, createInMemoryQuotaStore } from "./quota-store.js";
import { registerResponseMetrics } from "./response-metrics.js";
import { registerScreenManifestRoute } from "./screen-manifest.js";
import { registerSearchRoute } from "./search-route.js";
import { proxyFetch, getBreakerStates } from "./upstream-proxy.js";
import { jwtEdgeVerify } from "./jwt-edge.js";
import { getConfig, applyConfig, ConfigError, type GatewayRuntimeConfig } from "./runtime-config.js";

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
const PUBLIC_PREFIXES = ["/api/identity", "/api/v1/install", "/api/v1/careers"];

/** Verify the internal service-to-service secret (timing-safe). */
function verifyInternalSecret(req: FastifyRequest): boolean {
  const secret = req.headers["x-internal-secret"] as string | undefined;
  const expected = process.env.INTERNAL_SERVICE_SECRET;
  if (!expected || expected.length === 0) return false;
  if (!secret || secret.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(secret, "utf8"), Buffer.from(expected, "utf8"));
}

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

  // V-01: Module-guard enforcement — reject requests for disabled modules before proxying.
  const moduleAllowed = await checkModuleEnabled(req, reply, route.name);
  if (!moduleAllowed) return; // reply already sent with 403

  // V-02: ABAC policy enforcement — evaluate mutations against policy-service rules.
  const policyAllowed = await checkPolicy(req, reply, route.name);
  if (!policyAllowed) return; // reply already sent with 403

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
  const body = hasBody ? JSON.stringify(req.body ?? {}) : null;

  // ── Per-upstream circuit breaker + timeout ──────────────────────────────────
  const result = await proxyFetch({
    serviceName: route.name,
    url: targetUrl,
    method: req.method,
    headers,
    body,
  });

  if (!result.ok) {
    return reply.code(result.status).send({
      code: result.code,
      message: result.message,
      correlationId: req.id,
    });
  }

  const upstream = result.response;

  // ── Stream piping — avoid buffering large responses in gateway memory ───────
  reply.code(upstream.status);
  const ct = upstream.headers.get("content-type");
  if (ct) reply.header("content-type", ct);

  // Forward content-disposition for file downloads (reports, exports)
  const cd = upstream.headers.get("content-disposition");
  if (cd) reply.header("content-disposition", cd);

  // Forward content-length so the client knows how much to expect
  const cl = upstream.headers.get("content-length");
  if (cl) reply.header("content-length", cl);

  if (!upstream.body) {
    return reply.send("");
  }

  // Convert the web ReadableStream to a Node.js Readable and pipe it.
  // This avoids buffering the entire response body in gateway memory —
  // critical for large report exports, CSV downloads, etc.
  const reader = upstream.body.getReader();
  const nodeStream = new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(Buffer.from(value));
        }
      } catch {
        this.destroy();
      }
    },
  });

  return reply.send(nodeStream);
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
  // H8 FIX: Back rate-limit with Redis so it is fleet-wide (not per-pod).
  // @fastify/rate-limit accepts a `redis` option for distributed counters.
  const rateLimitRedisUrl = process.env.REDIS_URL ?? process.env.GATEWAY_REDIS_URL ?? "";
  const rateLimitStore = rateLimitRedisUrl
    ? { url: rateLimitRedisUrl }
    : undefined;

  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.GATEWAY_RATE_LIMIT_MAX ?? 1000),
    timeWindow: process.env.GATEWAY_RATE_LIMIT_WINDOW ?? "1 minute",
    ...(rateLimitStore ? { redis: rateLimitStore } : {}),
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
    ...(rateLimitStore ? { redis: rateLimitStore } : {}),
  });

  // Phase 1 hyperscale: per-tenant configurable quota enforcement.
  // Uses Redis for distributed counters (survives restart, fleet-wide enforcement).
  const REDIS_URL = process.env.REDIS_URL ?? process.env.GATEWAY_REDIS_URL ?? "";
  const quotaStore = REDIS_URL
    ? await createRedisQuotaStore(REDIS_URL)
    : createInMemoryQuotaStore();
  await app.register(quotaCheckPlugin, {
    store: quotaStore,
    tenantServiceUrl: process.env.GATEWAY_TENANT_URL ?? "http://127.0.0.1:3002",
    shadowMode: process.env.QUOTA_SHADOW_MODE === "true",
  });

  registerResponseMetrics(app);
  registerScreenManifestRoute(app);
  registerSearchRoute(app);

  // ── W1.4: API Key authentication — runs BEFORE JWT verification ───────────
  // If x-api-key is present, resolves key → scopes → tenant context.
  // If absent, falls through to JWT auth path.
  const { apiKeyPreHandler } = await import("./api-key-auth.js");
  app.addHook("preHandler", apiKeyPreHandler);

  // ── JWT edge verification — validate token signatures before proxying ─────
  // Runs as a preHandler on all routes. In "off" mode it's a no-op.
  app.addHook("preHandler", jwtEdgeVerify);

  // ── Circuit breaker state endpoint (ops visibility) ─────────────────────────
  app.get("/ops/breakers", async (_req, reply) => {
    return reply.send({ breakers: getBreakerStates() });
  });

  // ── Internal runtime config endpoints (service-to-service) ─────────────────
  // Called by admin-service to push config changes. Authenticated via x-internal-secret.
  app.get("/internal/config", async (req, reply) => {
    if (!verifyInternalSecret(req)) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "invalid internal secret" });
    }
    return reply.send({ data: getConfig() });
  });

  app.patch("/internal/config", async (req, reply) => {
    if (!verifyInternalSecret(req)) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "invalid internal secret" });
    }
    try {
      const patch = req.body as Partial<GatewayRuntimeConfig>;
      const updated = applyConfig(patch);
      return reply.send({ status: "updated", data: updated });
    } catch (err) {
      if (err instanceof ConfigError) {
        return reply.code(400).send({ code: "VALIDATION_FAILED", message: err.message });
      }
      throw err;
    }
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
      // Return 400 for malformed JSON — never 500.
      const syntaxErr = err as Error & { statusCode?: number };
      syntaxErr.statusCode = 400;
      done(syntaxErr, undefined);
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
