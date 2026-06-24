import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";
import type { ChecklistRow } from "./schema.js";

const AUDIT_ROLES = ["audit_officer", "audit_admin", "super_admin"];
const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;

const createBody = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  items: z.array(z.string().min(1).max(500)).min(1).max(100),
});

function toDto(r: ChecklistRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    title: r.title,
    description: r.description ?? null,
    items: r.items,
    completed: r.completed,
    completedBy: r.completedBy ?? null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: (r.createdAt as Date).toISOString(),
    createdBy: r.createdBy,
  };
}

export async function checklistRoutes(app: FastifyInstance): Promise<void> {
  // P0-4: persisted to compliance.audit_checklists (was an in-memory array that
  // was lost on every restart). Writes are transactional and emit an audit event.
  app.post("/v1/audit/compliance/checklists", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const body = createBody.parse(req.body);

    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertChecklist(tx, {
        id, tenantId: ctx.tenantId, title: body.title,
        description: body.description ?? null, items: body.items,
        completed: false, createdBy: ctx.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { service: "audit", action: "create", resourceType: "compliance_checklist", resourceId: id, outcome: "success" },
      });
    });

    const created = await repo.findChecklistByIdTx(db, id, ctx.tenantId);
    return reply.code(201).send({ data: created ? toDto(created) : null });
  });

  app.get("/v1/audit/compliance/checklists", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const { items, total } = await repo.listChecklists(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: items.map(toDto), total });
  });

  app.patch("/v1/audit/compliance/checklists/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const updated = await db.transaction(async (tx) => {
      const record = await repo.findChecklistByIdTx(tx, id, ctx.tenantId);
      if (!record) throw new HttpError(404, "NOT_FOUND", "checklist not found");
      if (record.completed) throw new HttpError(409, "ALREADY_COMPLETED", "checklist already completed");
      const rows = await repo.completeChecklistVersioned(tx, id, ctx.tenantId, record.version ?? 1, ctx.actorId);
      if (rows !== 1) throw new HttpError(409, "VERSION_CONFLICT", "checklist was modified concurrently");
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { service: "audit", action: "complete", resourceType: "compliance_checklist", resourceId: id, outcome: "success" },
      });
      return repo.findChecklistByIdTx(tx, id, ctx.tenantId);
    });
    return reply.send({ data: updated ? toDto(updated) : null });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
