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
import { instanceRoutes } from "./modules/instances/routes.js";
import { taskRoutes } from "./modules/tasks/routes.js";
import { definitionRoutes } from "./modules/definitions/routes.js";
import { delegationRoutes } from "./modules/delegations/routes.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { bpmnRoutes } from "./modules/bpmn/routes.js";
import { assignmentRoutes } from "./modules/assignment/routes.js";
import { messageRoutes } from "./modules/messages/routes.js";
import { forwardingRoutes } from "./modules/forwarding/routes.js";
import { decisionRoutes } from "./modules/decisions/routes.js";
import { simulationRoutes } from "./modules/simulation/routes.js";
import { externalTaskRoutes } from "./modules/external-tasks/routes.js";
import { designerRoutes } from "./modules/designer/routes.js";
import { dmnRoutes } from "./modules/dmn/routes.js";
import { authorityRoutes } from "./modules/authority/routes.js";
import { quorumRoutes } from "./modules/quorum/routes.js";
import { slaRoutes } from "./modules/sla/routes.js";
import { finalizationRoutes } from "./modules/finalization/routes.js";

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
  registerOpsRoutes(app, { service: "workflow-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });
  await app.register(definitionRoutes);
  await app.register(instanceRoutes);
  await app.register(taskRoutes);
  await app.register(delegationRoutes);
  await app.register(analyticsRoutes);
  await app.register(adminRoutes);
  await app.register(bpmnRoutes);
  await app.register(assignmentRoutes);
  await app.register(messageRoutes);
  await app.register(forwardingRoutes);
  await app.register(decisionRoutes);
  await app.register(simulationRoutes);
  await app.register(externalTaskRoutes);
  await app.register(designerRoutes);
  await app.register(dmnRoutes);
  await app.register(authorityRoutes);
  await app.register(quorumRoutes);
  await app.register(slaRoutes);
  await app.register(finalizationRoutes);
  registerSchemaErrorHandler(app, HttpError);
  return app;
}
