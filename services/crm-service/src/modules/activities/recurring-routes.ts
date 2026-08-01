/**
 * Recurring task routes with overdue escalation (AC-005).
 * GET   /v1/crm/recurring-tasks         — list (subject / cadence / enabled filters)
 * GET   /v1/crm/recurring-tasks/due     — definitions whose next run has arrived
 * POST  /v1/crm/recurring-tasks         — create a definition
 * PATCH /v1/crm/recurring-tasks/:id     — amend a definition
 * POST  /v1/crm/recurring-tasks/:id/run — materialise the next occurrence
 *
 * "Materialising" writes a concrete next_action row (AC-002) and advances the
 * schedule, so the recurring definition and the actionable task stay separate.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead, db } from "../../shared/db.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import { EVENTS } from "../../topics.js";
import { CADENCES, isCadence, nextOccurrence, shouldEscalate } from "./recurrence-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const RESOURCE = "recurring_task";

const SUBJECT_TYPES = ["contact", "deal"] as const;

/** A year of escalation delay is already absurd; anything more is a typo. */
const MAX_ESCALATE_HOURS = 8760;

const idParam = z.object({ id: z.string().uuid() });

const createBody = z.object({
  name: z.string().min(1).max(200),
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  cadence: z.enum(CADENCES),
  nextRunAt: z.string().datetime(),
  escalateAfterHours: z.number().int().min(1).max(MAX_ESCALATE_HOURS).optional(),
  enabled: z.boolean().default(true),
});

const updateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  cadence: z.enum(CADENCES).optional(),
  nextRunAt: z.string().datetime().optional(),
  escalateAfterHours: z.number().int().min(1).max(MAX_ESCALATE_HOURS).nullable().optional(),
  enabled: z.boolean().optional(),
  version: z.number().int().min(1).optional(),
}).refine(
  (b) => b.name !== undefined || b.cadence !== undefined || b.nextRunAt !== undefined
    || b.escalateAfterHours !== undefined || b.enabled !== undefined,
  { message: "at least one mutable field is required" },
);

const listRecurringQuery = listQuery.extend({
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectId: z.string().uuid().optional(),
  cadence: z.enum(CADENCES).optional(),
  enabled: z.enum(["true", "false"]).optional(),
});

const dueQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const SELECT_COLUMNS = sql`
  id,
  name,
  subject_type          AS "subjectType",
  subject_id            AS "subjectId",
  cadence,
  next_run_at           AS "nextRunAt",
  last_run_at           AS "lastRunAt",
  escalate_after_hours  AS "escalateAfterHours",
  enabled,
  created_at            AS "createdAt",
  updated_at            AS "updatedAt",
  version
`;

type TaskRow = Record<string, unknown>;

export async function recurringTaskRoutes(app: FastifyInstance): Promise<void> {
  /** List recurring definitions. */
  app.get("/v1/crm/recurring-tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listRecurringQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const typeFilter = q.subjectType ? sql`AND subject_type = ${q.subjectType}` : sql``;
    const subjectFilter = q.subjectId ? sql`AND subject_id = ${q.subjectId}` : sql``;
    const cadenceFilter = q.cadence ? sql`AND cadence = ${q.cadence}` : sql``;
    const enabledFilter = q.enabled !== undefined ? sql`AND enabled = ${q.enabled === "true"}` : sql``;

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.recurring_tasks
        WHERE tenant_id = ${ctx.tenantId} ${typeFilter} ${subjectFilter} ${cadenceFilter} ${enabledFilter}
        ORDER BY next_run_at ASC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as TaskRow[];
      const counted = await tx.execute(sql`
        SELECT count(*)::int AS total
        FROM crm.recurring_tasks
        WHERE tenant_id = ${ctx.tenantId} ${typeFilter} ${subjectFilter} ${cadenceFilter} ${enabledFilter}
      `) as unknown as Array<{ total: number }>;
      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    return reply.send(listEnvelope(rows, w, total));
  });

  /**
   * Definitions whose next run has arrived. Each row is annotated with whether
   * it has now been outstanding long enough to escalate.
   */
  app.get("/v1/crm/recurring-tasks/due", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = dueQuery.parse(req.query ?? {});

    const rows = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.recurring_tasks
        WHERE tenant_id = ${ctx.tenantId} AND enabled AND next_run_at <= now()
        ORDER BY next_run_at ASC
        LIMIT ${q.limit}
      `) as unknown as Array<TaskRow & { nextRunAt: Date | string; escalateAfterHours: number | null }>;
    });

    const now = new Date();
    const data = rows.map((r) => ({
      ...r,
      escalate: shouldEscalate(r.nextRunAt, r.escalateAfterHours, now),
    }));

    return reply.send({ data, meta: { page: 1, pageSize: q.limit, total: data.length } });
  });

  /** Create a recurring definition. */
  app.post("/v1/crm/recurring-tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);

    const taskId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.recurring_tasks
          (id, tenant_id, name, subject_type, subject_id, cadence, next_run_at,
           escalate_after_hours, enabled, created_by, updated_by)
        VALUES (
          ${taskId}, ${ctx.tenantId}, ${body.name}, ${body.subjectType}, ${body.subjectId},
          ${body.cadence}, ${body.nextRunAt}::timestamptz,
          ${body.escalateAfterHours ?? null}, ${body.enabled}, ${ctx.actorId}, ${ctx.actorId}
        )
      `);
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.recurringTaskCreated,
        action: "create",
        resourceType: RESOURCE,
        resourceId: taskId,
        payload: { taskId, cadence: body.cadence, subjectType: body.subjectType, subjectId: body.subjectId },
      });
    });

    return reply.code(201).send({
      data: {
        id: taskId,
        name: body.name,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        cadence: body.cadence,
        nextRunAt: body.nextRunAt,
        lastRunAt: null,
        escalateAfterHours: body.escalateAfterHours ?? null,
        enabled: body.enabled,
        version: 1,
      },
    });
  });

  /** Amend a recurring definition. */
  app.patch("/v1/crm/recurring-tasks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const current = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, version FROM crm.recurring_tasks
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; version: number }>;
    });
    if (current.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "recurring task not found");
    }

    const sets = [
      body.name !== undefined ? sql`name = ${body.name}` : null,
      body.cadence !== undefined ? sql`cadence = ${body.cadence}` : null,
      body.nextRunAt !== undefined ? sql`next_run_at = ${body.nextRunAt}::timestamptz` : null,
      body.escalateAfterHours !== undefined ? sql`escalate_after_hours = ${body.escalateAfterHours}` : null,
      body.enabled !== undefined ? sql`enabled = ${body.enabled}` : null,
    ].filter((s): s is NonNullable<typeof s> => s !== null);

    const versionGuard = body.version !== undefined ? sql`AND version = ${body.version}` : sql``;

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE crm.recurring_tasks
        SET ${sql.join(sets, sql`, `)}, updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} ${versionGuard}
        RETURNING id, version
      `) as unknown as Array<{ id: string; version: number }>;
      if (rows.length === 0) return rows;
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.recurringTaskUpdated,
        action: "update",
        resourceType: RESOURCE,
        resourceId: id,
        payload: { taskId: id, changed: Object.keys(body).filter((k) => k !== "version") },
      });
      return rows;
    });

    const row = updated[0];
    if (!row) {
      throw new HttpError(409, "VERSION_CONFLICT", "recurring task was modified by another request");
    }

    return reply.send({ data: { id, version: row.version } });
  });

  /**
   * Materialise the occurrence that is currently due: write the concrete next
   * action, then roll the schedule forward from the OLD next_run_at (not from
   * "now") so a late scheduler run does not drift the cadence.
   */
  app.post("/v1/crm/recurring-tasks/:id/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const found = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, name, subject_type AS "subjectType", subject_id AS "subjectId", cadence,
               next_run_at AS "nextRunAt", enabled, version
        FROM crm.recurring_tasks
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{
        id: string;
        name: string;
        subjectType: string;
        subjectId: string;
        cadence: string;
        nextRunAt: Date | string;
        enabled: boolean;
        version: number;
      }>;
    });
    const task = found[0];
    if (!task) {
      throw new HttpError(404, "NOT_FOUND", "recurring task not found");
    }
    if (!task.enabled) {
      throw new HttpError(422, "TASK_DISABLED", "cannot run a disabled recurring task");
    }
    if (!isCadence(task.cadence)) {
      throw new HttpError(422, "INVALID_STATE", `stored cadence '${task.cadence}' is not recognised`);
    }

    const dueAt = task.nextRunAt instanceof Date ? task.nextRunAt : new Date(task.nextRunAt);
    const nextRunAt = nextOccurrence(task.cadence, dueAt);
    const actionId = randomUUID();

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE crm.recurring_tasks
        SET last_run_at = now(), next_run_at = ${nextRunAt.toISOString()}::timestamptz,
            updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND version = ${task.version}
        RETURNING id, version
      `) as unknown as Array<{ id: string; version: number }>;
      if (rows.length === 0) return rows;

      await tx.execute(sql`
        INSERT INTO crm.next_actions
          (id, tenant_id, subject_type, subject_id, action_type, due_at, notes, created_by, updated_by)
        VALUES (
          ${actionId}, ${ctx.tenantId}, ${task.subjectType}, ${task.subjectId},
          'recurring_followup', ${dueAt.toISOString()}::timestamptz, ${task.name},
          ${ctx.actorId}, ${ctx.actorId}
        )
      `);

      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.recurringTaskRun,
        action: "run",
        resourceType: RESOURCE,
        resourceId: id,
        payload: {
          taskId: id,
          materialisedActionId: actionId,
          dueAt: dueAt.toISOString(),
          nextRunAt: nextRunAt.toISOString(),
        },
      });
      return rows;
    });

    const row = updated[0];
    if (!row) {
      throw new HttpError(409, "VERSION_CONFLICT", "recurring task was modified by another request");
    }

    return reply.code(201).send({
      data: {
        id,
        materialisedActionId: actionId,
        dueAt: dueAt.toISOString(),
        nextRunAt: nextRunAt.toISOString(),
        version: row.version,
      },
    });
  });
}
