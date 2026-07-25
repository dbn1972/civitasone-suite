import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
const ADMIN = ["super_admin", "platform_admin"];
export async function dataMigrationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/org/migrations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ sourceTenantId: z.string().uuid(), targetTenantId: z.string().uuid(), entities: z.array(z.string()).min(1), dryRun: z.boolean().default(true) }).parse(req.body);
    const id = randomUUID();
    await queue.publish("tenant.migration.start", { messageId: id, type: "tenant.migration.start", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body } });
    return reply.code(202).send({ data: { migrationId: id, status: "queued", dryRun: body.dryRun } });
  });
  app.get("/v1/org/migrations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: [], meta: { total: 0 } });
  });
  app.get("/v1/org/migrations/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: { id, status: "pending", entities: [], recordsMigrated: 0 } });
  });
  app.post("/v1/org/reconciliation", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ tenantId: z.string().uuid(), entityType: z.string().min(1), sourceSystem: z.string().min(1) }).parse(req.body);
    const id = randomUUID();
    await queue.publish("tenant.reconciliation.start", { messageId: id, type: "tenant.reconciliation.start", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body } });
    return reply.code(202).send({ data: { reconciliationId: id, status: "queued" } });
  });
  app.get("/v1/org/reconciliation/:id/breaks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: [], meta: { total: 0 } });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
