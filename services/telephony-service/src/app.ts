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
import { callRoutes } from "./modules/calls/routes.js";
import { queueRoutes } from "./modules/queues/routes.js";
import { agentRoutes } from "./modules/agents/routes.js";
import { webhookRoutes } from "./modules/webhooks/routes.js";
import { didRoutes } from "./modules/did/routes.js";
import { ivrRoutes } from "./modules/ivr/routes.js";
import { ivrActionRoutes } from "./modules/ivr/action-routes.js";
import { recordingRoutes } from "./modules/recordings/routes.js";
import { transcriptionRoutes } from "./modules/transcription/routes.js";
import { broadcastRoutes } from "./modules/broadcast/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  // G2: RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "telephony-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(callRoutes);
  await app.register(queueRoutes);
  await app.register(agentRoutes);
  await app.register(webhookRoutes);
  await app.register(didRoutes);
  await app.register(ivrRoutes);
  // Gap 6 & 7: IVR → create lead, IVR → send SMS
  await app.register(ivrActionRoutes);
  await app.register(recordingRoutes);
  await app.register(transcriptionRoutes);
  // CH-11: Voice broadcast
  await app.register(broadcastRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
