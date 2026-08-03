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
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand } from "../../shared/residual-publish.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
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
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await publishCrmCommand(ctx, COMMANDS.scheduleQbr, qbrId, {
        accountId: body.accountId,
        quarter: body.quarter,
        scheduledAt: body.scheduledAt,
        attendees: body.attendees,
        agenda: body.agenda,
      }),
    );
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

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await publishCrmCommand(ctx, COMMANDS.completeQbr, id, {
        status: body.status,
        outcomes: body.outcomes,
        version: current.version,
      }),
    );
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

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await publishCrmCommand(ctx, COMMANDS.cancelQbr, id, {
        reason: body.reason.trim(),
        version: current.version,
      }),
    );
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
