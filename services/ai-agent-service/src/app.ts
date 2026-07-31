import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { chatRoutes } from "./modules/chat/routes.js";
import { copilotRoutes } from "./modules/copilot/routes.js";
import { agentRoutes } from "./modules/agents/routes.js";
import { governanceRoutes } from "./modules/governance/routes.js";
import { guardrailRoutes } from "./modules/guardrails/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, {
    service: "ai-agent-service",
    checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue },
  });

  await app.register(chatRoutes);
  await app.register(copilotRoutes);
  await app.register(agentRoutes);
  await app.register(governanceRoutes);
  await app.register(guardrailRoutes);

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error.validation) {
      return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: error.message } });
    }
    reply.log.error(error);
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "unexpected error" } });
  });

  return app;
}
