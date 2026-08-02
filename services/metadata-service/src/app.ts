import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { entityRoutes } from "./modules/entities/routes.js";
import { fieldRoutes } from "./modules/fields/routes.js";
import { layoutRoutes } from "./modules/layouts/routes.js";
import { recordRoutes } from "./modules/records/routes.js";
import { validationRuleRoutes } from "./modules/rules/routes.js";
import { formulaRoutes } from "./modules/formula/routes.js";
import { compositionRoutes } from "./modules/composition/routes.js";
import { previewRoutes } from "./modules/preview/routes.js";
import { numberingRoutes } from "./modules/numbering/routes.js";
import { formRoutes } from "./modules/forms/routes.js";
import { publicFormRoutes } from "./modules/forms/public-routes.js";
import { assertPiiKeyConfigured } from "./shared/pii-crypto.js";

export async function buildApp(): Promise<FastifyInstance> {
  // Fail closed in production if the at-rest PII key is missing: the public lead
  // form writes encrypted name/email/phone columns and must never fall back to
  // plaintext. No-op outside production so dev and tests boot without the key.
  assertPiiKeyConfigured();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID() });
  await app.register(authPlugin as any);
  app.addHook("onRequest", createTenantTxHook(db));
  app.addHook("onRequest", async (req) => { const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId; if (tid) tenantStorage.enterWith({ tenantId: tid }); });
  registerOpsRoutes(app, { service: "metadata-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  await app.register(entityRoutes);
  await app.register(fieldRoutes);
  await app.register(layoutRoutes);
  await app.register(recordRoutes);
  await app.register(validationRuleRoutes);
  await app.register(formulaRoutes);
  await app.register(compositionRoutes);
  await app.register(previewRoutes);
  await app.register(numberingRoutes);
  // FRM-04 / FRM-05 / FRM-07 — authenticated forms-engine routes.
  await app.register(formRoutes);
  // ── LM-002 ── UNAUTHENTICATED. Every route in this plugin skips JWT
  // verification. Kept in its own file so the whole public surface of this
  // service is one import; see modules/forms/public-routes.ts for the threat
  // model (tenant resolution, rate limits, body/UTM bounds, no reflection).
  await app.register(publicFormRoutes);
  registerSchemaErrorHandler(app, HttpError);
  return app;
}
