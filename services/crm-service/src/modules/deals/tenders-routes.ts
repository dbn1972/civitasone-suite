/**
 * Tender / RFP tracking routes (KA-003).
 * GET   /v1/crm/tenders                 — list (bidStage / accountId filters)
 * GET   /v1/crm/tenders/upcoming        — deadlines within N days
 * POST  /v1/crm/tenders                 — register a tender
 * PATCH /v1/crm/tenders/:id             — amend a tender
 * POST  /v1/crm/tenders/:id/stage       — bid-stage transition (state machine)
 *
 * MONEY: `estimatedValueMinor` is bigint paise. It crosses the wire as a STRING
 * and is cast in SQL — it is never parsed into a JS number, so values above 2^53
 * round-trip exactly.
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
import {
  BID_STAGES,
  canTransition,
  isBidStage,
  isTerminalStage,
  isValidLossReason,
  requiresLossReason,
  allowedNextStages,
  LOSS_REASON_MIN_LENGTH,
} from "./tender-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const RESOURCE = "tender";

const idParam = z.object({ id: z.string().uuid() });

/** Minor units arrive as digit strings so no float ever touches money. */
const minorAmount = z.string().regex(/^\d{1,25}$/, "must be a non-negative integer string of minor units");

const createTenderBody = z.object({
  accountId: z.string().uuid().optional(),
  tenderRef: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  submissionDeadline: z.string().datetime().optional(),
  estimatedValueMinor: minorAmount.default("0"),
  currency: z.string().length(3).default("INR"),
  competitors: z.array(z.string().min(1).max(200)).max(50).default([]),
});

const updateTenderBody = z.object({
  title: z.string().min(1).max(300).optional(),
  submissionDeadline: z.string().datetime().optional(),
  estimatedValueMinor: minorAmount.optional(),
  currency: z.string().length(3).optional(),
  competitors: z.array(z.string().min(1).max(200)).max(50).optional(),
  accountId: z.string().uuid().optional(),
  version: z.number().int().min(1).optional(),
}).refine(
  (b) => b.title !== undefined || b.submissionDeadline !== undefined
    || b.estimatedValueMinor !== undefined || b.currency !== undefined
    || b.competitors !== undefined || b.accountId !== undefined,
  { message: "at least one mutable field is required" },
);

const stageBody = z.object({
  toStage: z.enum(BID_STAGES),
  reason: z.string().max(2000).default(""),
});

const listTendersQuery = listQuery.extend({
  stage: z.enum(BID_STAGES).optional(),
  accountId: z.string().uuid().optional(),
});

const upcomingQuery = z.object({
  withinDays: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const SELECT_COLUMNS = sql`
  id,
  account_id                   AS "accountId",
  tender_ref                   AS "tenderRef",
  title,
  bid_stage                    AS "bidStage",
  submission_deadline          AS "submissionDeadline",
  estimated_value_minor::text  AS "estimatedValueMinor",
  currency,
  competitors,
  loss_reason                  AS "lossReason",
  created_at                   AS "createdAt",
  updated_at                   AS "updatedAt",
  version
`;

type TenderRow = Record<string, unknown>;

export async function tenderRoutes(app: FastifyInstance): Promise<void> {
  /** List tenders with optional stage/account filters. */
  app.get("/v1/crm/tenders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listTendersQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const stageFilter = q.stage ? sql`AND bid_stage = ${q.stage}` : sql``;
    const accountFilter = q.accountId ? sql`AND account_id = ${q.accountId}` : sql``;

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.tenders
        WHERE tenant_id = ${ctx.tenantId} ${stageFilter} ${accountFilter}
        ORDER BY submission_deadline NULLS LAST, created_at DESC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as TenderRow[];
      const counted = await tx.execute(sql`
        SELECT count(*)::int AS total
        FROM crm.tenders
        WHERE tenant_id = ${ctx.tenantId} ${stageFilter} ${accountFilter}
      `) as unknown as Array<{ total: number }>;
      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    return reply.send(listEnvelope(rows, w, total));
  });

  /**
   * Tenders whose submission deadline falls inside the next N days and that are
   * still live (terminal stages are excluded — a won bid has no deadline left).
   */
  app.get("/v1/crm/tenders/upcoming", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = upcomingQuery.parse(req.query ?? {});

    const rows = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.tenders
        WHERE tenant_id = ${ctx.tenantId}
          AND bid_stage NOT IN ('won', 'lost')
          AND submission_deadline IS NOT NULL
          AND submission_deadline >= now()
          AND submission_deadline <= now() + make_interval(days => ${q.withinDays})
        ORDER BY submission_deadline ASC
        LIMIT ${q.limit}
      `) as unknown as TenderRow[];
    });

    return reply.send({
      data: rows,
      meta: { page: 1, pageSize: q.limit, total: rows.length, withinDays: q.withinDays },
    });
  });

  /** Register a tender. Duplicate tenderRef inside the tenant → 409. */
  app.post("/v1/crm/tenders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createTenderBody.parse(req.body);

    const existing = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id FROM crm.tenders
        WHERE tenant_id = ${ctx.tenantId} AND tender_ref = ${body.tenderRef}
      `) as unknown as Array<{ id: string }>;
    });
    if (existing.length > 0) {
      throw new HttpError(409, "TENDER_EXISTS", "a tender with this reference already exists");
    }

    const tenderId = randomUUID();
    // BigInt round-trip: proves the string is an exact integer before it reaches
    // the database, and echoes back the canonical form.
    const estimatedValueMinor = BigInt(body.estimatedValueMinor).toString();

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.tenders
          (id, tenant_id, account_id, tender_ref, title, bid_stage, submission_deadline,
           estimated_value_minor, currency, competitors, created_by, updated_by)
        VALUES (
          ${tenderId}, ${ctx.tenantId}, ${body.accountId ?? null}, ${body.tenderRef},
          ${body.title}, 'identified', ${body.submissionDeadline ?? null}::timestamptz,
          ${estimatedValueMinor}::bigint, ${body.currency.toUpperCase()},
          ${JSON.stringify(body.competitors)}::jsonb, ${ctx.actorId}, ${ctx.actorId}
        )
      `);
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.tenderCreated,
        action: "create",
        resourceType: RESOURCE,
        resourceId: tenderId,
        payload: {
          tenderId,
          tenderRef: body.tenderRef,
          bidStage: "identified",
          estimatedValueMinor,
          currency: body.currency.toUpperCase(),
        },
      });
    });

    return reply.code(201).send({
      data: {
        id: tenderId,
        accountId: body.accountId ?? null,
        tenderRef: body.tenderRef,
        title: body.title,
        bidStage: "identified",
        submissionDeadline: body.submissionDeadline ?? null,
        estimatedValueMinor,
        currency: body.currency.toUpperCase(),
        competitors: body.competitors,
        version: 1,
      },
    });
  });

  /** Amend a tender's descriptive fields. Stage changes go through /stage. */
  app.patch("/v1/crm/tenders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateTenderBody.parse(req.body);

    const current = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, bid_stage AS "bidStage", version FROM crm.tenders
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; bidStage: string; version: number }>;
    });
    const tender = current[0];
    if (!tender) {
      throw new HttpError(404, "NOT_FOUND", "tender not found");
    }
    if (isBidStage(tender.bidStage) && isTerminalStage(tender.bidStage)) {
      throw new HttpError(422, "TENDER_CLOSED", `cannot amend a tender in terminal stage '${tender.bidStage}'`);
    }

    const sets = [
      body.title !== undefined ? sql`title = ${body.title}` : null,
      body.submissionDeadline !== undefined
        ? sql`submission_deadline = ${body.submissionDeadline}::timestamptz` : null,
      body.estimatedValueMinor !== undefined
        ? sql`estimated_value_minor = ${BigInt(body.estimatedValueMinor).toString()}::bigint` : null,
      body.currency !== undefined ? sql`currency = ${body.currency.toUpperCase()}` : null,
      body.competitors !== undefined ? sql`competitors = ${JSON.stringify(body.competitors)}::jsonb` : null,
      body.accountId !== undefined ? sql`account_id = ${body.accountId}` : null,
    ].filter((s): s is NonNullable<typeof s> => s !== null);

    const versionGuard = body.version !== undefined ? sql`AND version = ${body.version}` : sql``;

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE crm.tenders
        SET ${sql.join(sets, sql`, `)}, updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} ${versionGuard}
        RETURNING id, version, estimated_value_minor::text AS "estimatedValueMinor"
      `) as unknown as Array<{ id: string; version: number; estimatedValueMinor: string }>;
      if (rows.length === 0) return rows;
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.tenderUpdated,
        action: "update",
        resourceType: RESOURCE,
        resourceId: id,
        payload: { tenderId: id, changed: Object.keys(body).filter((k) => k !== "version") },
      });
      return rows;
    });

    const row = updated[0];
    if (!row) {
      throw new HttpError(409, "VERSION_CONFLICT", "tender was modified by another request");
    }

    return reply.send({
      data: { id, version: row.version, estimatedValueMinor: row.estimatedValueMinor },
    });
  });

  /** Bid-stage transition, guarded by the pure state machine. */
  app.post("/v1/crm/tenders/:id/stage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = stageBody.parse(req.body);

    const found = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, bid_stage AS "bidStage", version FROM crm.tenders
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; bidStage: string; version: number }>;
    });
    const tender = found[0];
    if (!tender) {
      throw new HttpError(404, "NOT_FOUND", "tender not found");
    }
    if (!isBidStage(tender.bidStage)) {
      throw new HttpError(422, "INVALID_STATE", `stored bid stage '${tender.bidStage}' is not recognised`);
    }

    // A loss must be explained BEFORE the state machine check so the caller gets
    // the more actionable 400 rather than a generic 422 for a well-formed move.
    if (requiresLossReason(body.toStage) && !isValidLossReason(body.reason)) {
      throw new HttpError(
        400,
        "REASON_REQUIRED",
        `a reason of at least ${LOSS_REASON_MIN_LENGTH} characters is required when marking a tender lost`,
      );
    }

    if (!canTransition(tender.bidStage, body.toStage)) {
      const allowed = allowedNextStages(tender.bidStage);
      throw new HttpError(
        422,
        "INVALID_TRANSITION",
        allowed.length === 0
          ? `'${tender.bidStage}' is terminal; no further transitions are allowed`
          : `cannot move from '${tender.bidStage}' to '${body.toStage}' (allowed: ${allowed.join(", ")})`,
      );
    }

    const lossReason = body.toStage === "lost" ? body.reason.trim() : null;

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE crm.tenders
        SET bid_stage = ${body.toStage},
            loss_reason = COALESCE(${lossReason}, loss_reason),
            updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND version = ${tender.version}
        RETURNING id, version
      `) as unknown as Array<{ id: string; version: number }>;
      if (rows.length === 0) return rows;
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.tenderStageChanged,
        action: "stage_change",
        resourceType: RESOURCE,
        resourceId: id,
        payload: { tenderId: id, fromStage: tender.bidStage, toStage: body.toStage },
      });
      return rows;
    });

    const row = updated[0];
    if (!row) {
      throw new HttpError(409, "VERSION_CONFLICT", "tender was modified by another request");
    }

    return reply.send({
      data: { id, fromStage: tender.bidStage, bidStage: body.toStage, version: row.version },
    });
  });
}
