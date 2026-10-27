import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerRateLimit } from "@civitasone/rate-limit";
import { registerOpsRoutes } from "@civitasone/observability";
import { createQueue, resolveQueueDriver } from "./bus.js";

/**
 * queue-service — platform message-bus ops surface (SCORE_LOCK F2 / F9).
 *
 * This service is bus-only infrastructure: it does NOT own domain entities or
 * apply CQRS command writes. Domain services embed `@civitasone/queue` and run
 * their own workers/consumers. Therefore SCORE_LOCK F3/F4 are N/A → DONE for
 * this module (no route-layer domain mutations; no domain consumer to deploy
 * here). Deployability is the `queue` PM2 process + `/ready` 200 (PM2
 * `wait_ready` via `signalReady()` — see server.ts, PERF-015 tranche 5).
 */
// Trust X-Forwarded-For only from internal peers (gateway / web tier), so req.ip is the real client and an
// external caller cannot forge it. Same value as hrms-service INTERNAL_PROXY_TRUST. Deliberately not `true`.
const INTERNAL_PROXY_TRUST = "loopback,linklocal,uniquelocal";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // SEC: explicit request-body cap (1 MiB) -- bounds zod collection validation (GHSA-mrhx-c7xc-m3w5); guarded by scripts/ci/fastify-bodylimit-guard.mjs
    bodyLimit: 1_048_576,
    trustProxy: INTERNAL_PROXY_TRUST,
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  // Per-user rate limiting (300 req/min keyed by actorId, ops paths excluded), same shape as
  // hrms/billing/audit-service. authPlugin is registered first so req.ctx is populated.
  await registerRateLimit(app, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => (req as { ctx?: { actorId?: string } }).ctx?.actorId ?? req.ip ?? "anonymous",
    skip: (req) => (req.url ?? "").startsWith("/health") || (req.url ?? "").startsWith("/ready") || (req.url ?? "").startsWith("/metrics"),
  });

  const bus = createQueue();
  // PERF-015 tranche 5: tie the bus client's lifecycle to the Fastify app's
  // own close lifecycle so registerGracefulShutdown()'s `await app.close()`
  // (server.ts) also stops queue polling/connections, not just the HTTP
  // listener — otherwise a "graceful" HTTP drain would leave SQS long-polls /
  // a RabbitMQ channel / MemoryQueue backoff timers running past shutdown.
  app.addHook("onClose", async () => {
    await bus.stop();
  });
  registerOpsRoutes(app, { service: "queue-service", checks: { queue: bus } });

  // V4-B-10: these routes are NOT public. authPlugin verifies the bearer JWT (or
  // x-internal + constant-time INTERNAL_SERVICE_SECRET) before the handler runs.

  /** Bus health + driver — primary ops probe for F2. */
  app.get("/v1/queue/status", async () => {
    const status = await bus.healthCheck();
    return {
      driver: resolveQueueDriver(),
      healthy: status.healthy,
      mode: "bus-only",
      domainMutations: "n/a",
      dlqNote: "Per-service DLQ lives in MemoryQueue.dlq during tests; SQS DLQ via AWS config.",
    };
  });

  /** Supported drivers + production fail-closed contract. */
  app.get("/v1/queue/drivers", async (req: FastifyRequest) => {
    const q = z.object({}).parse(req.query ?? {});
    void q;
    return {
      data: {
        active: resolveQueueDriver(),
        supported: ["memory", "sqs", "rabbitmq"],
        productionForbidden: ["memory"],
        note: "Domain services create their own bus client via @civitasone/queue; this process is observability-only.",
      },
    };
  });

  /** Minimal ops catalogue so F2 list/get has a real surface beyond /status. */
  app.get("/v1/queue/ops", async () => {
    const status = await bus.healthCheck();
    return {
      data: {
        service: "queue-service",
        role: "platform_message_bus",
        healthy: status.healthy,
        driver: resolveQueueDriver(),
        endpoints: [
          { method: "GET", path: "/health", auth: "public" },
          { method: "GET", path: "/ready", auth: "public" },
          { method: "GET", path: "/v1/queue/status", auth: "verified-bearer|x-internal+secret" },
          { method: "GET", path: "/v1/queue/drivers", auth: "verified-bearer|x-internal+secret" },
          { method: "GET", path: "/v1/queue/ops", auth: "verified-bearer|x-internal+secret" },
        ],
        cqrs: {
          f3: "n/a — no domain mutation routes (bus observability only)",
          f4: "n/a — domain consumers run in per-service *-worker processes",
        },
      },
    };
  });

  return app;
}
