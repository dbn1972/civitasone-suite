import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { canClose, canReopen, canArchive } from "./domain.js";

const USER = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin", "case_manager"];
const ADMIN = ["workflow_admin", "super_admin", "tenant_admin", "case_manager"];

const entitySchema = z.object({ entityType: z.string().min(1).max(48), entityId: z.string().uuid() });

export async function closureRoutes(app: FastifyInstance): Promise<void> {
  // CAP-040 — current closure status for an entity.
  app.get("/v1/workflow/closure", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const q = entitySchema.parse(req.query);
    const row = await repo.find(ctx.tenantId, q.entityType, q.entityId);
    return reply.send({ data: row ?? { entityType: q.entityType, entityId: q.entityId, status: "open" } });
  });

  // CAP-040 — close an entity (reason required).
  app.post("/v1/workflow/closure/close", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const body = entitySchema.extend({ reason: z.string().min(1).max(1000) }).parse(req.body);
    const status = await repo.currentStatus(ctx.tenantId, body.entityType, body.entityId);
    const guard = canClose(status, body.reason);
    if (!guard.allowed) throw new HttpError(409, "CLOSE_BLOCKED", guard.errors.join(", "));
    const row = await repo.close({ tenantId: ctx.tenantId, ...body, actorId: ctx.actorId, correlationId: ctx.correlationId });
    if (!row) throw new HttpError(409, "CLOSE_BLOCKED", "entity not in a closeable state");
    return reply.send({ data: row });
  });

  // CAP-040 — reopen a closed entity (reason required).
  app.post("/v1/workflow/closure/reopen", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = entitySchema.extend({ reason: z.string().min(1).max(1000) }).parse(req.body);
    const status = await repo.currentStatus(ctx.tenantId, body.entityType, body.entityId);
    const guard = canReopen(status, body.reason);
    if (!guard.allowed) throw new HttpError(409, "REOPEN_BLOCKED", guard.errors.join(", "));
    const row = await repo.reopen({ tenantId: ctx.tenantId, ...body, actorId: ctx.actorId, correlationId: ctx.correlationId });
    if (!row) throw new HttpError(409, "REOPEN_BLOCKED", "entity is not closed");
    return reply.send({ data: row });
  });

  // CAP-040 — archive a closed entity (terminal).
  app.post("/v1/workflow/closure/archive", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = entitySchema.parse(req.body);
    const status = await repo.currentStatus(ctx.tenantId, body.entityType, body.entityId);
    const guard = canArchive(status);
    if (!guard.allowed) throw new HttpError(409, "ARCHIVE_BLOCKED", guard.errors.join(", "));
    const row = await repo.archive({ tenantId: ctx.tenantId, ...body, actorId: ctx.actorId, correlationId: ctx.correlationId });
    if (!row) throw new HttpError(409, "ARCHIVE_BLOCKED", "entity must be closed to archive");
    return reply.send({ data: row });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
