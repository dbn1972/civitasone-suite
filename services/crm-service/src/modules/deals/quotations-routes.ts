/**
 * Quotation routes — templates, versions, acceptance (QP-003, QP-005).
 * GET  /v1/crm/quotations                  — list (dealId / status filters)
 * POST /v1/crm/quotations                  — create from a template
 * POST /v1/crm/quotations/:id/new-version   — clone and bump version_number
 * POST /v1/crm/quotations/:id/send          — draft → sent
 * POST /v1/crm/quotations/:id/accept        — sent → accepted (terminal)
 * POST /v1/crm/quotations/:id/reject        — sent → rejected (terminal, reason required)
 *
 * MONEY: `totalMinor` is bigint paise, carried as a STRING in JSON and summed
 * with BigInt. No float or JS number touches a money value anywhere here.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead, db } from "../../shared/db.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import { EVENTS } from "../../topics.js";
import {
  QUOTATION_STATUSES,
  canTransition,
  isQuotationStatus,
  isValidRejectReason,
  allowedNextStatuses,
  sumLineItems,
  REJECT_REASON_MIN_LENGTH,
  type QuotationStatus,
} from "./quotation-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const RESOURCE = "quotation";

const idParam = z.object({ id: z.string().uuid() });

const minorAmount = z.string().regex(/^\d{1,25}$/, "must be a non-negative integer string of minor units");

const lineItem = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(1_000_000),
  unitPriceMinor: minorAmount,
});

const createBody = z.object({
  dealId: z.string().uuid().optional(),
  quoteRef: z.string().min(1).max(120),
  templateRef: z.string().min(1).max(120),
  lineItems: z.array(lineItem).max(500).default([]),
  /** Only used when there are no line items (e.g. a lump-sum quote). */
  totalMinor: minorAmount.optional(),
  currency: z.string().length(3).default("INR"),
  validUntil: z.string().datetime().optional(),
});

const newVersionBody = z.object({
  lineItems: z.array(lineItem).max(500).optional(),
  totalMinor: minorAmount.optional(),
  validUntil: z.string().datetime().optional(),
});

const rejectBody = z.object({
  reason: z.string().max(2000).default(""),
});

const listQuotationsQuery = listQuery.extend({
  dealId: z.string().uuid().optional(),
  status: z.enum(QUOTATION_STATUSES).optional(),
});

const SELECT_COLUMNS = sql`
  id,
  deal_id          AS "dealId",
  quote_ref        AS "quoteRef",
  template_ref     AS "templateRef",
  version_number   AS "versionNumber",
  status,
  total_minor::text AS "totalMinor",
  currency,
  valid_until      AS "validUntil",
  line_items       AS "lineItems",
  reject_reason    AS "rejectReason",
  sent_at          AS "sentAt",
  decided_at       AS "decidedAt",
  created_at       AS "createdAt",
  updated_at       AS "updatedAt",
  version
`;

type QuotationRow = Record<string, unknown>;

interface QuotationState {
  id: string;
  quoteRef: string;
  templateRef: string | null;
  dealId: string | null;
  versionNumber: number;
  status: string;
  totalMinor: string;
  currency: string;
  lineItems: unknown;
  version: number;
}

/**
 * Resolves the authoritative total: line items win when present, because a total
 * that disagrees with its own lines is a data bug, not a business decision.
 */
function resolveTotal(
  lineItems: z.infer<typeof lineItem>[] | undefined,
  totalMinor: string | undefined,
  fallback: string,
): string {
  if (lineItems !== undefined && lineItems.length > 0) return sumLineItems(lineItems).toString();
  if (totalMinor !== undefined) return BigInt(totalMinor).toString();
  return BigInt(fallback).toString();
}

export async function quotationRoutes(app: FastifyInstance): Promise<void> {
  /** List quotations. */
  app.get("/v1/crm/quotations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuotationsQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const dealFilter = q.dealId ? sql`AND deal_id = ${q.dealId}` : sql``;
    const statusFilter = q.status ? sql`AND status = ${q.status}` : sql``;

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.quotations
        WHERE tenant_id = ${ctx.tenantId} ${dealFilter} ${statusFilter}
        ORDER BY quote_ref ASC, version_number DESC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as QuotationRow[];
      const counted = await tx.execute(sql`
        SELECT count(*)::int AS total
        FROM crm.quotations
        WHERE tenant_id = ${ctx.tenantId} ${dealFilter} ${statusFilter}
      `) as unknown as Array<{ total: number }>;
      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    return reply.send(listEnvelope(rows, w, total));
  });

  /** Create version 1 of a quotation from a template. */
  app.post("/v1/crm/quotations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);

    const existing = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id FROM crm.quotations
        WHERE tenant_id = ${ctx.tenantId} AND quote_ref = ${body.quoteRef} AND version_number = 1
      `) as unknown as Array<{ id: string }>;
    });
    if (existing.length > 0) {
      throw new HttpError(409, "QUOTE_EXISTS", "a quotation with this reference already exists");
    }

    const quotationId = randomUUID();
    const totalMinor = resolveTotal(body.lineItems, body.totalMinor, "0");

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.quotations
          (id, tenant_id, deal_id, quote_ref, template_ref, version_number, status,
           total_minor, currency, valid_until, line_items, created_by, updated_by)
        VALUES (
          ${quotationId}, ${ctx.tenantId}, ${body.dealId ?? null}, ${body.quoteRef},
          ${body.templateRef}, 1, 'draft', ${totalMinor}::bigint,
          ${body.currency.toUpperCase()}, ${body.validUntil ?? null}::timestamptz,
          ${JSON.stringify(body.lineItems)}::jsonb, ${ctx.actorId}, ${ctx.actorId}
        )
      `);
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.quotationCreated,
        action: "create",
        resourceType: RESOURCE,
        resourceId: quotationId,
        payload: {
          quotationId,
          quoteRef: body.quoteRef,
          versionNumber: 1,
          totalMinor,
          currency: body.currency.toUpperCase(),
        },
      });
    });

    return reply.code(201).send({
      data: {
        id: quotationId,
        dealId: body.dealId ?? null,
        quoteRef: body.quoteRef,
        templateRef: body.templateRef,
        versionNumber: 1,
        status: "draft",
        totalMinor,
        currency: body.currency.toUpperCase(),
        validUntil: body.validUntil ?? null,
        lineItems: body.lineItems,
        version: 1,
      },
    });
  });

  /**
   * Clone into a new revision. The clone always starts as `draft`: a revision is
   * a fresh offer, so it must be explicitly sent again.
   */
  app.post("/v1/crm/quotations/:id/new-version", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = newVersionBody.parse(req.body);

    const source = await loadQuotation(ctx.tenantId, id);

    const maxRows = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT max(version_number)::int AS "maxVersion"
        FROM crm.quotations
        WHERE tenant_id = ${ctx.tenantId} AND quote_ref = ${source.quoteRef}
      `) as unknown as Array<{ maxVersion: number | null }>;
    });
    const nextVersionNumber = (maxRows[0]?.maxVersion ?? source.versionNumber) + 1;

    const clonedLineItems = body.lineItems ?? (source.lineItems as z.infer<typeof lineItem>[]);
    const totalMinor = resolveTotal(body.lineItems, body.totalMinor, source.totalMinor);
    const newId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.quotations
          (id, tenant_id, deal_id, quote_ref, template_ref, version_number, status,
           total_minor, currency, valid_until, line_items, created_by, updated_by)
        SELECT ${newId}, tenant_id, deal_id, quote_ref, template_ref, ${nextVersionNumber}, 'draft',
               ${totalMinor}::bigint, currency,
               COALESCE(${body.validUntil ?? null}::timestamptz, valid_until),
               ${JSON.stringify(clonedLineItems)}::jsonb, ${ctx.actorId}, ${ctx.actorId}
        FROM crm.quotations
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `);
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.quotationVersioned,
        action: "new_version",
        resourceType: RESOURCE,
        resourceId: newId,
        payload: {
          quotationId: newId,
          clonedFrom: id,
          quoteRef: source.quoteRef,
          versionNumber: nextVersionNumber,
          totalMinor,
        },
      });
    });

    return reply.code(201).send({
      data: {
        id: newId,
        clonedFrom: id,
        quoteRef: source.quoteRef,
        versionNumber: nextVersionNumber,
        status: "draft",
        totalMinor,
        lineItems: clonedLineItems,
        version: 1,
      },
    });
  });

  /** draft → sent */
  app.post("/v1/crm/quotations/:id/send", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const q = await loadQuotation(ctx.tenantId, id);
    assertTransition(q.status, "sent");

    const version = await transitionStatus(ctx, {
      id,
      expectedVersion: q.version,
      fromStatus: q.status,
      toStatus: "sent",
      extraSets: sql`, sent_at = now()`,
      eventType: EVENTS.quotationSent,
      action: "send",
      extraPayload: {},
    });

    return reply.send({ data: { id, status: "sent", version } });
  });

  /** sent → accepted (terminal) */
  app.post("/v1/crm/quotations/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const q = await loadQuotation(ctx.tenantId, id);
    assertTransition(q.status, "accepted");

    const version = await transitionStatus(ctx, {
      id,
      expectedVersion: q.version,
      fromStatus: q.status,
      toStatus: "accepted",
      extraSets: sql`, decided_at = now()`,
      eventType: EVENTS.quotationAccepted,
      action: "accept",
      extraPayload: { totalMinor: q.totalMinor, currency: q.currency },
    });

    return reply.send({
      data: { id, status: "accepted", totalMinor: q.totalMinor, currency: q.currency, version },
    });
  });

  /** sent → rejected (terminal); a reason is mandatory for loss analysis. */
  app.post("/v1/crm/quotations/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectBody.parse(req.body);

    if (!isValidRejectReason(body.reason)) {
      throw new HttpError(
        400,
        "REASON_REQUIRED",
        `a reason of at least ${REJECT_REASON_MIN_LENGTH} characters is required to reject a quotation`,
      );
    }

    const q = await loadQuotation(ctx.tenantId, id);
    assertTransition(q.status, "rejected");

    const version = await transitionStatus(ctx, {
      id,
      expectedVersion: q.version,
      fromStatus: q.status,
      toStatus: "rejected",
      extraSets: sql`, decided_at = now(), reject_reason = ${body.reason.trim()}`,
      eventType: EVENTS.quotationRejected,
      action: "reject",
      extraPayload: {},
    });

    return reply.send({ data: { id, status: "rejected", version } });
  });
}

async function loadQuotation(tenantId: string, id: string): Promise<QuotationState> {
  const rows = await scopedRead(async (tx) => {
    return tx.execute(sql`
      SELECT id, quote_ref AS "quoteRef", template_ref AS "templateRef", deal_id AS "dealId",
             version_number AS "versionNumber", status, total_minor::text AS "totalMinor",
             currency, line_items AS "lineItems", version
      FROM crm.quotations
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `) as unknown as QuotationState[];
  });
  const row = rows[0];
  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "quotation not found");
  }
  return row;
}

function assertTransition(from: string, to: QuotationStatus): void {
  if (!isQuotationStatus(from)) {
    throw new HttpError(422, "INVALID_STATE", `stored status '${from}' is not recognised`);
  }
  if (!canTransition(from, to)) {
    const allowed = allowedNextStatuses(from);
    throw new HttpError(
      422,
      "INVALID_TRANSITION",
      allowed.length === 0
        ? `'${from}' is terminal; no further transitions are allowed`
        : `cannot move from '${from}' to '${to}' (allowed: ${allowed.join(", ")})`,
    );
  }
}

interface StatusTransition {
  id: string;
  expectedVersion: number;
  fromStatus: string;
  toStatus: QuotationStatus;
  extraSets: ReturnType<typeof sql>;
  eventType: string;
  action: string;
  extraPayload: Record<string, unknown>;
}

/**
 * Applies a status change and its audit trail in ONE transaction — the audit row
 * must commit with the status change or not at all. Optimistic lock: if another
 * request moved the row, nothing is written and the caller gets 409.
 */
async function transitionStatus(ctx: RequestContext, t: StatusTransition): Promise<number> {
  const rows = await db.transaction(async (tx) => {
    const updated = await tx.execute(sql`
      UPDATE crm.quotations
      SET status = ${t.toStatus}${t.extraSets},
          updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
      WHERE id = ${t.id} AND tenant_id = ${ctx.tenantId} AND version = ${t.expectedVersion}
      RETURNING id, version
    `) as unknown as Array<{ id: string; version: number }>;
    if (updated.length === 0) return updated;
    await emitWithAudit(tx, ctx, {
      eventType: t.eventType,
      action: t.action,
      resourceType: RESOURCE,
      resourceId: t.id,
      payload: {
        quotationId: t.id,
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
        ...t.extraPayload,
      },
    });
    return updated;
  });

  const row = rows[0];
  if (!row) {
    throw new HttpError(409, "VERSION_CONFLICT", "quotation was modified by another request");
  }
  return row.version;
}
