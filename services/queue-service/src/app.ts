import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerOpsRoutes } from "@civitasone/observability";
import { createQueue, resolveQueueDriver } from "./bus.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  const bus = createQueue();
  registerOpsRoutes(app, { service: "queue-service", checks: { queue: bus } });

  app.get("/v1/queue/status", { config: { public: true } }, async (req: FastifyRequest, reply) => {
    const auth = req.headers.authorization;
    const internal = req.headers["x-internal"];
    if ((!auth || typeof auth !== "string") && internal !== "1") {
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "authentication or internal header required" });
    }
    const status = await bus.healthCheck();
    return {
      driver: resolveQueueDriver(),
      healthy: status.healthy,
      dlqNote: "Per-service DLQ lives in MemoryQueue.dlq during tests; SQS DLQ via AWS config.",
    };
  });

  return app;
}
