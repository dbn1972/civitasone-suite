/**
 * Quarterly business review routes (KA-005).
 * GET  /v1/crm/qbr              — list (accountId / status / quarter filters)
 * GET  /v1/crm/qbr/upcoming     — reviews scheduled within N days
 * POST /v1/crm/qbr              — schedule a review
 * POST /v1/crm/qbr/:id/complete — record outcomes
 * POST /v1/crm/qbr/:id/cancel   — cancel with a mandatory reason
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

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const RESOURCE = "qbr";

const QBR_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;

/** Fiscal quarter label, e.g. 2026-Q1. */
const QUARTER_PATTERN = /^\d{4}-Q[1-4]$/;

/** A cancellation must be explained — an unexplained cancelled QBR is a red flag. */
const CANCEL_REASON_MIN_LENGTH = 10;

const idParam = z.object({ id: z.string().uuid() });

const outcomeItem = z.object({
  topic: z.string().min(1).max(300),
  decision: z.string().max(2000).optional(),
  ownerId: z.string().uuid().optional(),
});

const scheduleBody = z.object({
  accountId: z.string().uuid(),
  quarter: z.string().regex(QUARTER_PATTERN, "quarter must look like 2026-Q1"),
  scheduledAt: z.string().datetime(),
  attendees: z.array(z.string().min(1).max(200)).max(100).default([]),
  agenda: z.array(z.string().min(1).max(500)).max(100).default([]),
});

const completeBody = z.object({
  outcomes: z.array(outcomeItem).min(1).max(100),
  /** A booked review nobody attended is recorded as no_show, not completed. */
  status: z.enum(["completed", "no_show"]).default("completed"),
});

const cancelBody = z.object({
  reason: z.string().max(2000).default(""),
});

const listQbrQuery = listQuery.extend({
  accountId: z.string().uuid().optional(),
  status: z.enum(QBR_STATUSES).optional(),
  quarter: z.string().regex(QUARTER_PATTERN).optional(),
});

const upcomingQuery = z.object({
  withinDays: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const SELECT_COLUMNS = sql`
  id,
  account_id    AS "accountId",
  quarter,
  scheduled_at  AS "scheduledAt",
  status,
  attendees,
  agenda,
  outcomes,
  cancel_reason AS "cancelReason",
  created_at    AS "createdAt",
  updated_at    AS "updatedAt",
  version
`;

type QbrRow = Record<string, unknown>;

export async function qbrRoutes(app: FastifyInstance): Promise<void> {
  /** List QBR schedules. */
  app.get("/v1/crm/qbr", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQbrQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const accountFilter = q.accountId ? sql`AND account_id = ${q.accountId}` : sql``;
    const statusFilter = q.status ? sql`AND status = ${q.status}` : sql``;
    const quarterFilter = q.quarter ? sql`AND quarter = ${q.quarter}` : sql``;

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.qbr_schedules
        WHERE tenant_id = ${ctx.tenantId} ${accountFilter} ${statusFilter} ${quarterFilter}
        ORDER BY scheduled_at DESC NULLS LAST
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as QbrRow[];
      const counted = await tx.execute(sql`
        SELECT count(*)::int AS total
        FROM crm.qbr_schedules
        WHERE tenant_id = ${ctx.tenantId} ${accountFilter} ${statusFilter} ${quarterFilter}
      `) as unknown as Array<{ total: number }>;
      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    return reply.send(listEnvelope(rows, w, total));
  });

  /** Reviews still to be held inside the next N days. */
  app.get("/v1/crm/qbr/upcoming", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = upcomingQuery.parse(req.query ?? {});

    const rows = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.qbr_schedules
        WHERE tenant_id = ${ctx.tenantId}
          AND status = 'scheduled'
          AND scheduled_at IS NOT NULL
          AND scheduled_at >= now()
          AND scheduled_at <= now() + make_interval(days => ${q.withinDays})
        ORDER BY scheduled_at ASC
        LIMIT ${q.limit}
      `) as unknown as QbrRow[];
    });

    return reply.send({
      data: rows,
      meta: { page: 1, pageSize: q.limit, total: rows.length, withinDays: q.withinDays },
    });
  });

  /** Schedule a review. One per account per quarter (409 on repeat). */
  app.post("/v1/crm/qbr", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = scheduleBody.parse(req.body);

    const existing = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id FROM crm.qbr_schedules
        WHERE tenant_id = ${ctx.tenantId} AND account_id = ${body.accountId} AND quarter = ${body.quarter}
      `) as unknown as Array<{ id: string }>;
    });
    if (existing.length > 0) {
      throw new HttpError(409, "QBR_EXISTS", "a QBR already exists for this account and quarter");
    }

    const qbrId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.qbr_schedules
          (id, tenant_id, account_id, quarter, scheduled_at, status, attendees, agenda,
           created_by, updated_by)
        VALUES (
          ${qbrId}, ${ctx.tenantId}, ${body.accountId}, ${body.quarter},
          ${body.scheduledAt}::timestamptz, 'scheduled',
          ${JSON.stringify(body.attendees)}::jsonb,
          ${JSON.stringify(body.agenda)}::jsonb,
          ${ctx.actorId}, ${ctx.actorId}
        )
      `);
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.qbrScheduled,
        action: "schedule",
        resourceType: RESOURCE,
        resourceId: qbrId,
        payload: { qbrId, accountId: body.accountId, quarter: body.quarter, scheduledAt: body.scheduledAt },
      });
    });

    return reply.code(201).send({
      data: {
        id: qbrId,
        accountId: body.accountId,
        quarter: body.quarter,
        scheduledAt: body.scheduledAt,
        status: "scheduled",
        attendees: body.attendees,
        agenda: body.agenda,
        version: 1,
      },
    });
  });

  /** Record outcomes. Only a scheduled review can be completed. */
  app.post("/v1/crm/qbr/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);

    const current = await loadQbr(ctx.tenantId, id);
    if (current.status !== "scheduled") {
      throw new HttpError(422, "INVALID_STATE", `cannot complete a QBR in status '${current.status}'`);
    }

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE crm.qbr_schedules
        SET status = ${body.status},
            outcomes = ${JSON.stringify(body.outcomes)}::jsonb,
            updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND version = ${current.version}
        RETURNING id, version
      `) as unknown as Array<{ id: string; version: number }>;
      if (rows.length === 0) return rows;
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.qbrCompleted,
        action: "complete",
        resourceType: RESOURCE,
        resourceId: id,
        payload: { qbrId: id, status: body.status, outcomeCount: body.outcomes.length },
      });
      return rows;
    });

    const row = updated[0];
    if (!row) {
      throw new HttpError(409, "VERSION_CONFLICT", "QBR was modified by another request");
    }

    return reply.send({ data: { id, status: body.status, version: row.version } });
  });

  /** Cancel a review; a reason is mandatory. */
  app.post("/v1/crm/qbr/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = cancelBody.parse(req.body);

    if (body.reason.trim().length < CANCEL_REASON_MIN_LENGTH) {
      throw new HttpError(
        400,
        "REASON_REQUIRED",
        `a reason of at least ${CANCEL_REASON_MIN_LENGTH} characters is required to cancel a QBR`,
      );
    }

    const current = await loadQbr(ctx.tenantId, id);
    if (current.status !== "scheduled") {
      throw new HttpError(422, "INVALID_STATE", `cannot cancel a QBR in status '${current.status}'`);
    }

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE crm.qbr_schedules
        SET status = 'cancelled', cancel_reason = ${body.reason.trim()},
            updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND version = ${current.version}
        RETURNING id, version
      `) as unknown as Array<{ id: string; version: number }>;
      if (rows.length === 0) return rows;
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.qbrCancelled,
        action: "cancel",
        resourceType: RESOURCE,
        resourceId: id,
        payload: { qbrId: id },
      });
      return rows;
    });

    const row = updated[0];
    if (!row) {
      throw new HttpError(409, "VERSION_CONFLICT", "QBR was modified by another request");
    }

    return reply.send({ data: { id, status: "cancelled", version: row.version } });
  });
}

async function loadQbr(tenantId: string, id: string): Promise<{ status: string; version: number }> {
  const rows = await scopedRead(async (tx) => {
    return tx.execute(sql`
      SELECT status, version FROM crm.qbr_schedules
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `) as unknown as Array<{ status: string; version: number }>;
  });
  const row = rows[0];
  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "QBR not found");
  }
  return row;
}
