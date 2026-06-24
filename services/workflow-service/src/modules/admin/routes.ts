import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { roleMembers } from "../assignment/resolver.js";
import { and, eq } from "drizzle-orm";
import * as dlq from "../dlq/repo.js";
import * as historyRepo from "../history/repo.js";

const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

/**
 * Admin / ops surface:
 *  - Gap 3 — DLQ: list + requeue dead-lettered messages (tenant-scoped).
 *  - Gap 6 — audit export: paginated tenant-scoped date-ranged transition_history.
 *  - Gap 4 — role-member registry for auto-assignment (round-robin / hierarchy).
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Gap 3 — DLQ list
  // -------------------------------------------------------------------------
  app.get("/v1/workflow/dlq", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = z.object({
      status: z.enum(["dead", "requeued"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await dlq.listDeadLetters(ctx.tenantId, q.status, q.limit, q.offset);
    return reply.send({
      data: rows.map((r) => ({
        id: r.id, topic: r.topic, messageId: r.messageId, error: r.error,
        attemptCount: r.attemptCount, status: r.status,
        createdAt: r.createdAt, requeuedAt: r.requeuedAt,
      })),
    });
  });

  // Gap 3 — DLQ requeue: re-publish the stored envelope to its topic and mark
  // the dead letter requeued. Tenant-scoped (can only requeue own messages).
  app.post("/v1/workflow/dlq/:id/requeue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const dl = await dlq.findDeadLetter(id, ctx.tenantId);
    if (!dl) throw new HttpError(404, "NOT_FOUND", "dead letter not found");
    if (dl.status !== "dead") throw new HttpError(409, "ALREADY_REQUEUED", "dead letter already requeued");

    const env = dl.envelope as Record<string, unknown>;
    // re-publish with a FRESH messageId so the inbox-dedup and attempt counter
    // start clean; preserve tenant/actor/correlation/payload/type.
    await queue.publish(dl.topic, {
      messageId: randomUUID(),
      type: (env.type as string) ?? dl.topic,
      tenantId: ctx.tenantId,
      actorId: (env.actorId as string) ?? ctx.actorId,
      correlationId: (env.correlationId as string) ?? ctx.correlationId,
      schemaVersion: (env.schemaVersion as string) ?? "1.0",
      payload: env.payload,
    });
    const ok = await dlq.markRequeued(id, ctx.tenantId, ctx.actorId);
    if (!ok) throw new HttpError(409, "ALREADY_REQUEUED", "dead letter already requeued");
    return reply.send({ data: { id, status: "requeued" } });
  });

  // -------------------------------------------------------------------------
  // Gap 6 — audit export (RTI / audit). Paginated, tenant-scoped, date-ranged.
  // Cross-tenant rows are excluded by the tenant predicate in the query.
  // -------------------------------------------------------------------------
  app.get("/v1/workflow/audit/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
      limit: z.coerce.number().int().min(1).max(1000).default(500),
      afterCreatedAt: z.string().datetime().optional(),
      afterId: z.string().uuid().optional(),
    }).parse(req.query);

    const rows = await historyRepo.exportForTenant(
      ctx.tenantId,
      new Date(q.from),
      new Date(q.to),
      q.limit,
      q.afterCreatedAt ? new Date(q.afterCreatedAt) : null,
      q.afterId ?? null,
    );
    const last = rows[rows.length - 1];
    return reply.send({
      data: rows,
      // keyset cursor for the next page (null when fewer than `limit` returned).
      nextCursor: rows.length === q.limit && last
        ? { afterCreatedAt: last.createdAt, afterId: last.id }
        : null,
    });
  });

  // -------------------------------------------------------------------------
  // Gap 4 — role-member registry (candidate pool for auto-assignment).
  // -------------------------------------------------------------------------
  app.put("/v1/workflow/role-members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      roleRef: z.string().min(1).max(128),
      userId: z.string().uuid(),
      reportsTo: z.string().uuid().optional(),
      active: z.boolean().default(true),
    }).parse(req.body);

    await db.insert(roleMembers).values({
      tenantId: ctx.tenantId,
      roleRef: body.roleRef,
      userId: body.userId,
      ...(body.reportsTo !== undefined ? { reportsTo: body.reportsTo } : {}),
      active: body.active,
    }).onConflictDoUpdate({
      target: [roleMembers.tenantId, roleMembers.roleRef, roleMembers.userId],
      set: { reportsTo: body.reportsTo ?? null, active: body.active },
    });
    return reply.code(201).send({ data: { roleRef: body.roleRef, userId: body.userId } });
  });

  app.get("/v1/workflow/role-members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = z.object({ roleRef: z.string().max(128).optional() }).parse(req.query);
    const rows = await db.select().from(roleMembers)
      .where(and(
        eq(roleMembers.tenantId, ctx.tenantId),
        ...(q.roleRef ? [eq(roleMembers.roleRef, q.roleRef)] : []),
      ));
    return reply.send({ data: rows });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
