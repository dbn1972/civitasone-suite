import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { instanceRoutes } from "./modules/instances/routes.js";
import { taskRoutes } from "./modules/tasks/routes.js";
import { definitionRoutes } from "./modules/definitions/routes.js";
import { delegationRoutes } from "./modules/delegations/routes.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { bpmnRoutes } from "./modules/bpmn/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });
  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);
  registerOpsRoutes(app, { service: "workflow-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  await app.register(definitionRoutes);
  await app.register(instanceRoutes);
  await app.register(taskRoutes);
  await app.register(delegationRoutes);
  await app.register(analyticsRoutes);
  await app.register(adminRoutes);
  await app.register(bpmnRoutes);
  registerSchemaErrorHandler(app, HttpError);
  return app;
}
