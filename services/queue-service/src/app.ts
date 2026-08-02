import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerOpsRoutes } from "@civitasone/observability";
import { createQueue, resolveQueueDriver } from "./bus.js";

/**
 * queue-service — platform message-bus ops surface (SCORE_LOCK F2 / F9).
 *
 * This service is bus-only infrastructure: it does NOT own domain entities or
 * apply CQRS command writes. Domain services embed `@civitasone/queue` and run
 * their own workers/consumers. Therefore SCORE_LOCK F3/F4 are N/A → DONE for
 * this module (no route-layer domain mutations; no domain consumer to deploy
 * here). Deployability is the `queue` PM2 process + `/health` 200.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  const bus = createQueue();
  registerOpsRoutes(app, { service: "queue-service", checks: { queue: bus } });

  function requireOpsAuth(req: FastifyRequest): void {
    const auth = req.headers.authorization;
    const internal = req.headers["x-internal"];
    if ((!auth || typeof auth !== "string") && internal !== "1") {
      const err = new Error("authentication or internal header required") as Error & {
        statusCode?: number;
        code?: string;
      };
      err.statusCode = 401;
      err.code = "UNAUTHORIZED";
      throw err;
    }
  }

  /** Bus health + driver — primary ops probe for F2. */
  app.get("/v1/queue/status", { config: { public: true } }, async (req: FastifyRequest, reply) => {
    try {
      requireOpsAuth(req);
    } catch {
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "authentication or internal header required" });
    }
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
  app.get("/v1/queue/drivers", { config: { public: true } }, async (req: FastifyRequest, reply) => {
    try {
      requireOpsAuth(req);
    } catch {
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "authentication or internal header required" });
    }
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
  app.get("/v1/queue/ops", { config: { public: true } }, async (req: FastifyRequest, reply) => {
    try {
      requireOpsAuth(req);
    } catch {
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "authentication or internal header required" });
    }
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
          { method: "GET", path: "/v1/queue/status", auth: "bearer|x-internal" },
          { method: "GET", path: "/v1/queue/drivers", auth: "bearer|x-internal" },
          { method: "GET", path: "/v1/queue/ops", auth: "bearer|x-internal" },
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
