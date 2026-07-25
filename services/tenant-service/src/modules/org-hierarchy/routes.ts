import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
const ADMIN = ["super_admin", "platform_admin", "tenant_admin"];
export async function orgHierarchyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/org/hierarchy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: [] });
  });
  app.post("/v1/org/hierarchy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ name: z.string().min(1), type: z.enum(["department","division","section","unit","branch"]), parentId: z.string().uuid().optional() }).parse(req.body);
    const id = randomUUID();
    await queue.publish("tenant.org_unit.create", { messageId: id, type: "tenant.org_unit.create", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });
  app.post("/v1/org/master-data/import", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ entityType: z.string().min(1), records: z.array(z.record(z.unknown())).min(1).max(5000) }).parse(req.body);
    const batchId = randomUUID();
    await queue.publish("tenant.master_data.import", { messageId: batchId, type: "tenant.master_data.import", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { batchId, entityType: body.entityType, recordCount: body.records.length } });
    return reply.code(202).send({ data: { batchId, status: "queued", recordCount: body.records.length } });
  });
  app.post("/v1/org/master-data/export", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ entityType: z.string().min(1), format: z.enum(["csv","json"]).default("json") }).parse(req.body);
    return reply.code(202).send({ data: { exportId: randomUUID(), status: "generating" } });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
