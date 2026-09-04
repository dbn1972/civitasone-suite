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
import { facilityRoutes } from "./modules/facilities/routes.js";
import { bookingRoutes } from "./modules/bookings/routes.js";
import { recordRoutes } from "./modules/records/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  app.addHook("onRequest", createTenantTxHook(db));

  // G2: RLS enforcement — source the RLS tenant from the AUTHENTICATED token
  // (req.ctx, populated by authPlugin's earlier onRequest hook), not just the
  // client-supplied x-tenant-id header. createTenantTxHook only enters
  // AsyncLocalStorage when x-tenant-id is present; a spoofed header would
  // otherwise let an authenticated caller read/write another tenant's rows.
  // Header remains the fallback; the verified JWT tenant wins when present.
  // Mirrors admin-service / hrms-service / payroll-service.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, {
    service: "crematorium-service",
    checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue },
  });
  registerSchemaErrorHandler(app, HttpError);

  await app.register(facilityRoutes);
  await app.register(bookingRoutes);
  await app.register(recordRoutes);

  return app;
}
