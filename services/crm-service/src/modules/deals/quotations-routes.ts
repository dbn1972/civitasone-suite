/**
 * Quotation routes — templates, versions, acceptance (QP-003, QP-005).
 * Writes are CQRS: validate → queue.publish → 202 Accepted.
 *
 * MONEY: `totalMinor` is bigint paise, carried as a STRING in JSON and summed
 * with BigInt. No float or JS number touches a money value anywhere here.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
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
import * as commands from "./quotation-commands.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

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
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createQuotation(ctx, quotationId, {
        dealId: body.dealId ?? null,
        quoteRef: body.quoteRef,
        templateRef: body.templateRef,
        totalMinor,
        currency: body.currency.toUpperCase(),
        validUntil: body.validUntil ?? null,
        lineItems: body.lineItems,
      }),
    );
  });

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

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.versionQuotation(ctx, newId, {
        sourceId: id,
        nextVersionNumber,
        totalMinor,
        validUntil: body.validUntil ?? null,
        lineItems: clonedLineItems,
        quoteRef: source.quoteRef,
      }),
    );
  });

  app.post("/v1/crm/quotations/:id/send", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const q = await loadQuotation(ctx.tenantId, id);
    assertTransition(q.status, "sent");
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.sendQuotation(ctx, id, {
        expectedVersion: q.version,
        fromStatus: q.status,
      }),
    );
  });

  app.post("/v1/crm/quotations/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const q = await loadQuotation(ctx.tenantId, id);
    assertTransition(q.status, "accepted");
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.acceptQuotation(ctx, id, {
        expectedVersion: q.version,
        fromStatus: q.status,
        totalMinor: q.totalMinor,
        currency: q.currency,
      }),
    );
  });

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
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.rejectQuotation(ctx, id, {
        expectedVersion: q.version,
        fromStatus: q.status,
        reason: body.reason.trim(),
      }),
    );
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
