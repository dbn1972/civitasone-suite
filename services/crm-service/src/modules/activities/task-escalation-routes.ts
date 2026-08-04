/**
 * AC-005 — task-escalation rule admin (configurable schedule + escalation path).
 *   GET    /v1/crm/task-escalation-rules       — the tenant's rules
 *   POST   /v1/crm/task-escalation-rules        — create a rule (admin, audited)
 *   PUT    /v1/crm/task-escalation-rules/:id     — amend a rule (admin, audited)
 *   DELETE /v1/crm/task-escalation-rules/:id     — remove a rule (admin, audited)
 *
 * Writes are synchronous + transactionally audited (the dedup/reason-codes config
 * pattern): these are low-volume admin rows, not domain events.
 */
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];
const AUDIT = "audit.event.record";

const createBody = z.object({
  name: z.string().min(1).max(200),
  appliesTo: z.enum(["next_action", "task", "both"]).default("both"),
  thresholdMinutes: z.number().int().positive(),
  recipientRole: z.string().max(64).nullable().optional(),
  recipientId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().default(true),
});
const updateBody = createBody.partial().refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
const idParam = z.object({ id: z.string().uuid() });

const SELECT_COLS = sql`
  id, name, applies_to AS "appliesTo", threshold_minutes AS "thresholdMinutes",
  recipient_role AS "recipientRole", recipient_id AS "recipientId", enabled,
  created_at AS "createdAt", updated_at AS "updatedAt", version`;

export async function taskEscalationRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/task-escalation-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT ${SELECT_COLS} FROM crm.task_escalation_rules
      WHERE tenant_id = ${ctx.tenantId} ORDER BY threshold_minutes ASC
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/crm/task-escalation-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const b = createBody.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const inserted = (await tx.execute(sql`
        INSERT INTO crm.task_escalation_rules
          (tenant_id, name, applies_to, threshold_minutes, recipient_role, recipient_id, enabled, created_by, updated_by)
        VALUES (${ctx.tenantId}, ${b.name}, ${b.appliesTo}, ${b.thresholdMinutes},
                ${b.recipientRole ?? null}, ${b.recipientId ?? null}, ${b.enabled}, ${ctx.actorId}, ${ctx.actorId})
        RETURNING ${SELECT_COLS}
      `)) as unknown as Array<Record<string, unknown>>;
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { service: "crm", action: "task_escalation_rule_create", resourceType: "task_escalation_rule", resourceId: String(inserted[0]?.id), outcome: "success" },
      });
      return inserted[0];
    });
    return reply.code(201).send({ data: row });
  });

  app.put("/v1/crm/task-escalation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const b = updateBody.parse(req.body);
    const sets = [] as ReturnType<typeof sql>[];
    if (b.name !== undefined) sets.push(sql`name = ${b.name}`);
    if (b.appliesTo !== undefined) sets.push(sql`applies_to = ${b.appliesTo}`);
    if (b.thresholdMinutes !== undefined) sets.push(sql`threshold_minutes = ${b.thresholdMinutes}`);
    if (b.recipientRole !== undefined) sets.push(sql`recipient_role = ${b.recipientRole}`);
    if (b.recipientId !== undefined) sets.push(sql`recipient_id = ${b.recipientId}`);
    if (b.enabled !== undefined) sets.push(sql`enabled = ${b.enabled}`);
    sets.push(sql`updated_at = now()`);
    sets.push(sql`updated_by = ${ctx.actorId}`);
    sets.push(sql`version = version + 1`);
    const row = await db.transaction(async (tx) => {
      const updated = (await tx.execute(sql`
        UPDATE crm.task_escalation_rules SET ${sql.join(sets, sql`, `)}
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        RETURNING ${SELECT_COLS}
      `)) as unknown as Array<Record<string, unknown>>;
      if (updated.length === 0) return null;
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { service: "crm", action: "task_escalation_rule_update", resourceType: "task_escalation_rule", resourceId: id, outcome: "success" },
      });
      return updated[0];
    });
    if (!row) throw new HttpError(404, "NOT_FOUND", "rule not found");
    return reply.send({ data: row });
  });

  app.delete("/v1/crm/task-escalation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const deleted = await db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        DELETE FROM crm.task_escalation_rules WHERE id = ${id} AND tenant_id = ${ctx.tenantId} RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (rows.length === 0) return false;
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { service: "crm", action: "task_escalation_rule_delete", resourceType: "task_escalation_rule", resourceId: id, outcome: "success" },
      });
      return true;
    });
    if (!deleted) throw new HttpError(404, "NOT_FOUND", "rule not found");
    return reply.code(204).send();
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
