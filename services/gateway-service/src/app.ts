import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { Readable } from "node:stream";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { Redis } from "ioredis";
import { quotaCheckPlugin } from "@civitasone/db";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { resolveRoute, SERVICE_ROUTES } from "./registry.js";
import { checkModuleEnabled } from "./module-guard.js";
import { checkPolicy } from "./policy-check.js";
import { createRedisQuotaStore, createInMemoryQuotaStore } from "./quota-store.js";
import { registerResponseMetrics } from "./response-metrics.js";
import { registerScreenManifestRoute } from "./screen-manifest.js";
import { registerSearchRoute } from "./search-route.js";
import { proxyFetch, getBreakerStates } from "./upstream-proxy.js";
import { jwtEdgeVerify } from "./jwt-edge.js";
import { canonicalisePath, BAD_PATH_RESPONSE } from "./path-guard.js";
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
const STRIP_HEADERS = ["x-internal", "x-internal-secret", "x-internal-caller", "x-service-secret", "x-gateway-request"] as const;

/**
 * Routes that do NOT require a bearer token at the gateway.
 * SEC-3: sync/devices were REMOVED from this list — they carry tenant data and
 * must be authenticated at the edge. Only auth-bootstrap (identity login/refresh)
 * and the first-run installer remain public.
 *
 * `/api/v1/crm/public` is LM-002 public lead capture: a prospect filling in a web form
 * has no token by definition. Kept as narrow as the requirement allows — it is the
 * `public` sub-tree of the CRM prefix, NOT `/api/v1/crm`, so no authenticated CRM route
 * loses its edge check. The upstream still resolves the tenant from a 64-hex form key,
 * rate-limits per IP and per tenant, and enforces consent; see
 * crm-service/src/modules/leads/public-routes.ts for the threat model.
 */
const PUBLIC_PREFIXES = [
  "/api/identity",
  "/api/v1/install",
  "/api/v1/careers",
  "/api/v1/crm/public",
];

/** Verify the internal service-to-service secret (timing-safe). */
function verifyInternalSecret(req: FastifyRequest): boolean {
  const secret = req.headers["x-internal-secret"] as string | undefined;
  const expected = process.env.INTERNAL_SERVICE_SECRET;
  if (!expected || expected.length === 0) return false;
  if (!secret || secret.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(secret, "utf8"), Buffer.from(expected, "utf8"));
}

async function proxyHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  /**
   * Canonicalise BEFORE any decision, and use the single result for BOTH the public-prefix
   * check and the upstream lookup. Deriving the path twice, or deciding on the raw string
   * and forwarding something the URL parser reads differently, is what made
   * `POST /api/v1/crm/public/%2e%2e/contacts` skip the bearer check and land on
   * `/v1/crm/contacts`. See path-guard.ts for the full write-up.
   */
  const canonical = canonicalisePath(req.url);
  if (!canonical.ok) {
    req.log.warn({ correlationId: req.id, reason: canonical.reason }, "rejected malformed request path");
    return reply.code(400).send({ ...BAD_PATH_RESPONSE, correlationId: req.id });
  }
  const pathname = canonical.pathname;

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

  // Only the route is taken from the lookup; the remainder is re-derived below from the
  // RAW path so upstreams receive the client's own bytes.
  const { route } = resolved;

  // V-01: Module-guard enforcement — reject requests for disabled modules before proxying.
  const moduleAllowed = await checkModuleEnabled(req, reply, route.name);
  if (!moduleAllowed) return; // reply already sent with 403

  // V-02: ABAC policy enforcement — evaluate mutations against policy-service rules.
  const policyAllowed = await checkPolicy(req, reply, route.name);
  if (!policyAllowed) return; // reply already sent with 403

  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";

  /**
   * Forward the RAW path bytes, not the decoded ones. The guard has already established
   * that decoding cannot change the segment structure, so the route and prefix decisions
   * above hold for either form — but an upstream should still receive exactly what the
   * client sent (a `%23` decoded here would be read as a fragment by `fetch` and silently
   * truncate the path).
   *
   * The matched prefix is plain ASCII, so a raw path that does NOT start with it means the
   * client percent-encoded a character inside the prefix itself. That is the same
   * raw-vs-canonical divergence this guard exists to remove, so it is refused rather than
   * papered over by falling back to the decoded remainder.
   */
  const rawPathname = req.url.split("?")[0] ?? "/";
  if (!rawPathname.startsWith(route.prefix)) {
    req.log.warn({ correlationId: req.id, reason: "encoded_prefix" }, "rejected malformed request path");
    return reply.code(400).send({ ...BAD_PATH_RESPONSE, correlationId: req.id });
  }
  const rawRemainder = rawPathname.slice(route.prefix.length) || "/";
  const remainder = rawRemainder === "/" ? "" : rawRemainder;
  const basePath = route.upstreamPath ?? route.prefix.replace(/^\/api/, "");
  const targetUrl = `${route.upstream}${basePath}${remainder}${query}`;

  const headers: Record<string, string> = {};
  for (const h of FORWARD_HEADERS) {
    const v = req.headers[h];
    if (typeof v === "string") headers[h] = v;
  }
  if (!headers["x-correlation-id"]) headers["x-correlation-id"] = req.id;

  /**
   * Client IP, for upstreams that must rate-limit an UNAUTHENTICATED caller (crm-service's
   * public lead-capture endpoint, LM-002). Without this every anonymous submission looks
   * to the upstream like it came from the gateway, so a per-IP budget degrades into one
   * shared counter — and a shared counter is a denial-of-service weapon: one attacker
   * burns the whole tenant's budget.
   *
   * SET, not appended. `x-forwarded-for` is deliberately absent from FORWARD_HEADERS, so
   * whatever a client sent is already discarded; writing exactly one entry means the
   * header an upstream reads contains only the address the gateway itself observed and
   * nothing a caller can influence. Upstreams that consult it must trust exactly one hop
   * (TRUSTED_PROXY_HOPS=1) and read the LAST entry.
   */
  headers["x-forwarded-for"] = req.ip;

  // Defense-in-depth: ensure bypass headers never reach upstream regardless of FORWARD_HEADERS.
  for (const h of STRIP_HEADERS) {
    delete (headers as Record<string, string | undefined>)[h];
  }

  // Inject gateway-identity headers AFTER stripping so a client cannot forge them.
  // x-gateway-request is in STRIP_HEADERS above — any inbound value is already discarded.
  headers["x-gateway-request"] = "1";
  if (process.env.INTERNAL_SERVICE_SECRET) {
    headers["x-internal-secret"] = process.env.INTERNAL_SERVICE_SECRET;
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
  // @fastify/rate-limit v9 RedisStore calls redis.defineCommand() on the value
  // passed as { redis: ... }. A plain { url } object has no such method and
  // crashes. We must pass a real ioredis client instance.
  const rateLimitRedisUrl = process.env.REDIS_URL ?? process.env.GATEWAY_REDIS_URL ?? "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rateLimitClient: any = undefined;
  if (rateLimitRedisUrl) {
    try {
      rateLimitClient = new Redis(rateLimitRedisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
      await rateLimitClient.connect();
      app.log.info({ redisUrl: rateLimitRedisUrl }, "rate-limit: Redis store connected");
    } catch (err) {
      app.log.warn(
        { err, redisUrl: rateLimitRedisUrl },
        "rate-limit: Redis connection failed — falling back to in-process store",
      );
      rateLimitClient = undefined;
    }
  }

  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.GATEWAY_RATE_LIMIT_MAX ?? 1000),
    timeWindow: process.env.GATEWAY_RATE_LIMIT_WINDOW ?? "1 minute",
    ...(rateLimitClient ? { redis: rateLimitClient } : {}),
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
    ...(rateLimitClient ? { redis: rateLimitClient } : {}),
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

  // Build one health-check entry per unique upstream from the service registry.
  // Multiple route entries that share the same upstream (e.g. "estab" and
  // "establishment" both resolve to :3010) are collapsed to a single probe.
  const _upstreamNames = new Map<string, string>(); // url -> representative service name
  for (const route of SERVICE_ROUTES) {
    if (!_upstreamNames.has(route.upstream)) {
      _upstreamNames.set(route.upstream, route.name);
    }
  }
  const _dedupedUpstreams = [..._upstreamNames.entries()]; // [[url, name], ...]

  // Concurrent-probe batch: the first ping() call in a /ready request starts ALL
  // upstream fetches simultaneously (Promise.allSettled). Subsequent ping() calls
  // for the same /ready request await the already-in-flight promises rather than
  // launching new fetches. The batch reference is cleared after all probes settle,
  // so the next /ready call starts a fresh batch.
  let _batchProbes: Map<string, Promise<boolean>> | null = null;

  function _makePing(url: string): () => Promise<boolean> {
    return async () => {
      if (!_batchProbes) {
        _batchProbes = new Map(
          _dedupedUpstreams.map(([u]) => [
            u,
            fetch(`${u}/health`, { signal: AbortSignal.timeout(2000) })
              .then((r) => r.ok)
              .catch(() => false),
          ])
        );
        void Promise.allSettled([..._batchProbes.values()]).then(() => {
          _batchProbes = null;
        });
      }
      return _batchProbes!.get(url)!;
    };
  }

  // /health (liveness)  — always 200; handled by registerOpsRoutes; never probes upstreams.
  // /ready (readiness)  — 503 when any upstream is degraded; load balancers use this to
  //                       stop routing traffic. Response body: { checks: { <name>: bool } }
  //                       identifies which upstreams are degraded.
  registerOpsRoutes(app, {
    service: "gateway-service",
    checks: {
      custom: _dedupedUpstreams.map(([url, name]) => ({
        name,
        ping: _makePing(url),
      })),
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

  // CAP-052: API catalogue is the one persistent store the gateway owns
  // (DB civitas_gateway). Mounted only when DATABASE_URL is configured so the
  // gateway still boots as a pure stateless proxy in DB-less environments.
  if (process.env.DATABASE_URL) {
    const { catalogueRoutes } = await import("./modules/catalogue/routes.js");
    await app.register(catalogueRoutes);
  }

  registerSchemaErrorHandler(app);

  return app;
}
