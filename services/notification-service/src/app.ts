import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { templateRoutes } from "./modules/templates/routes.js";
import { deliveryRoutes } from "./modules/deliveries/routes.js";
import { channelRoutes } from "./modules/channels/routes.js";
import { alertRoutes } from "./modules/alerts/routes.js";
import { bulkRoutes } from "./modules/bulk/routes.js";
import { inboxRoutes } from "./modules/inbox/routes.js";
import { streamRoutes } from "./modules/stream/routes.js";
import { schedulingRoutes } from "./modules/scheduling/routes.js";
import { digestRoutes } from "./modules/digest/routes.js";
import { webhookRoutes } from "./modules/webhook/routes.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { dndRoutes } from "./modules/dnd/routes.js";
import { i18nRoutes } from "./modules/i18n/routes.js";
import { segmentRoutes } from "./modules/segments/routes.js";
import { approvalRoutes } from "./modules/approval/routes.js";

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

  // Source the RLS tenant from the AUTHENTICATED token (req.ctx, populated by
  // authPlugin's earlier onRequest hook), not the client-supplied x-tenant-id
  // header. createTenantTxHook only enters AsyncLocalStorage when x-tenant-id is
  // present; token-based requests omit it, so without this the app.tenant_id GUC
  // stays unset and -- under fail-closed RLS -- reads return zero rows. Sourcing
  // tenantId from the verified token makes scopedRead()'s transaction set the GUC
  // so RLS enforces isolation on reads AND writes.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, { service: "notification-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(templateRoutes);
  await app.register(deliveryRoutes);
  await app.register(channelRoutes);
  await app.register(alertRoutes);
  await app.register(bulkRoutes);
  await app.register(inboxRoutes);
  await app.register(streamRoutes);
  await app.register(schedulingRoutes);
  await app.register(digestRoutes);
  await app.register(webhookRoutes);
  await app.register(analyticsRoutes);
  await app.register(dndRoutes);
  await app.register(i18nRoutes);
  await app.register(segmentRoutes);
  await app.register(approvalRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
