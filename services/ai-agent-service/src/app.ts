import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { chatRoutes } from "./modules/chat/routes.js";
import { chatSessionRoutes } from "./modules/chat/session-routes.js";
import { copilotRoutes } from "./modules/copilot/routes.js";
import { copilotSuggestRoutes } from "./modules/copilot/suggest-routes.js";
import { agentRoutes } from "./modules/agents/routes.js";
import { orchestrationRoutes } from "./modules/agents/orchestration-routes.js";
import { opsRoutes } from "./modules/agents/ops-routes.js";
import { authoringRoutes } from "./modules/authoring/routes.js";
import { governanceRoutes } from "./modules/governance/routes.js";
import { qualityRoutes } from "./modules/governance/quality-routes.js";
import { protocolRoutes } from "./modules/protocols/routes.js";
import { toolRoutes } from "./modules/tools/routes.js";
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

  // Uniform error envelope: ZodError → 400, HttpError → mapped status, else 500.
  registerSchemaErrorHandler(app, HttpError);

  await app.register(chatRoutes);
  await app.register(chatSessionRoutes);
  await app.register(copilotRoutes);
  await app.register(copilotSuggestRoutes);
  await app.register(agentRoutes);
  await app.register(orchestrationRoutes);
  await app.register(opsRoutes);
  await app.register(authoringRoutes);
  await app.register(governanceRoutes);
  await app.register(qualityRoutes);
  await app.register(protocolRoutes);
  await app.register(toolRoutes);
  await app.register(guardrailRoutes);

  return app;
}
