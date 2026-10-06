/**
 * Quotation routes — templates, versions, acceptance (QP-003, QP-005), plus the QP-004
 * send-gate and QP-005 convert-to-order.
 *
 * MONEY: `totalMinor` / `unitPriceMinor` are bigint paise, carried as STRINGS in JSON and
 * summed with BigInt. No float or JS number touches a money value anywhere here.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import {
  QUOTATION_STATUSES,
  canTransition,
  isQuotationStatus,
  isValidRejectReason,
  allowedNextStatuses,
  sumLineItems,
  computeTotals,
  gstSplit,
  ALLOWED_CURRENCIES,
  REJECT_REASON_MIN_LENGTH,
  type QuotationStatus,
} from "./quotation-domain.js";
import * as commands from "./quotation-commands.js";
import * as approvalRepo from "./quotation-approval-repo.js";
import { effectiveDiscountBps } from "./quotation-approval-domain.js";
import * as productRepo from "../products/repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

const minorAmount = z.string().regex(/^\d{1,25}$/, "must be a non-negative integer string of minor units");

// F4-02: an Indian state code is a 1-2 digit GST state code (e.g. "27" Maharashtra,
// "07" Delhi). Stored uppercased/padded, used only to decide intra- vs inter-state.
const stateCode = z.string().regex(/^\d{1,2}$/, "must be a 1-2 digit Indian state code");
const currencyCode = z.enum(ALLOWED_CURRENCIES);

// QP-003: a line may be sourced from a catalogue product (productId) and carry a tax rate.
const lineItem = z.object({
  productId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(1_000_000),
  unitPriceMinor: minorAmount,
  taxRateBps: z.number().int().min(0).max(100000).optional(),
});

const createBody = z.object({
  dealId: z.string().uuid().optional(),
  quoteRef: z.string().min(1).max(120),
  templateRef: z.string().min(1).max(120),
  lineItems: z.array(lineItem).max(500).default([]),
  totalMinor: minorAmount.optional(),
  currency: currencyCode.default("INR"),
  placeOfSupply: stateCode.nullable().optional(),
  supplierState: stateCode.nullable().optional(),
  validUntil: z.string().datetime().optional(),
});

const newVersionBody = z.object({
  lineItems: z.array(lineItem).max(500).optional(),
  totalMinor: minorAmount.optional(),
  placeOfSupply: stateCode.nullable().optional(),
  supplierState: stateCode.nullable().optional(),
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
  total_minor::text AS "netMinor",
  tax_minor::text   AS "taxMinor",
  grand_total_minor::text AS "grandTotalMinor",
  currency,
  place_of_supply  AS "placeOfSupply",
  supplier_state   AS "supplierState",
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
  grandTotalMinor: string;
  currency: string;
  placeOfSupply: string | null;
  supplierState: string | null;
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

/**
 * F4-01: compute net / tax / grand-total (bigint paise) from the line items. When the
 * caller sends no line items but a flat `totalMinor` (header-only quote), tax is 0 and
 * grand == net, so `fallbackNet` carries the resolved net through unchanged.
 */
function resolveMoney(
  items: z.infer<typeof lineItem>[] | undefined,
  totalMinor: string | undefined,
  fallback: string,
): { netMinor: string; taxMinor: string; grandTotalMinor: string } {
  if (items !== undefined && items.length > 0) {
    const t = computeTotals(items);
    return {
      netMinor: t.netMinor.toString(),
      taxMinor: t.taxMinor.toString(),
      grandTotalMinor: t.grandTotalMinor.toString(),
    };
  }
  const net = resolveTotal(items, totalMinor, fallback);
  return { netMinor: net, taxMinor: "0", grandTotalMinor: net };
}

/**
 * F4-03: a quotation stays single-currency. Every product-sourced line must carry the
 * same currency as the quotation header; a mismatch is rejected with 422 so the UI can
 * show an inline error. Lines without a product link carry no own currency and are
 * assumed to be in the quotation currency (the clerk typed a raw price).
 */
async function assertSingleCurrency(
  tenantId: string,
  currency: string,
  items: z.infer<typeof lineItem>[],
): Promise<void> {
  const header = currency.toUpperCase();
  const productIds = items.map((i) => i.productId).filter((id): id is string => !!id);
  if (productIds.length === 0) return;
  const currencies = await productRepo.currenciesByIds(tenantId, productIds);
  for (const item of items) {
    if (!item.productId) continue;
    const lineCurrency = currencies.get(item.productId);
    if (lineCurrency && lineCurrency !== header) {
      throw new HttpError(
        422,
        "CURRENCY_MISMATCH",
        `product ${item.productId} is priced in ${lineCurrency}, which cannot be added to a ${header} quotation`,
      );
    }
  }
}

/** QP-001/QP-003: every product-sourced line must reference an active, enabled product. */
async function assertProductsSelectable(tenantId: string, items: z.infer<typeof lineItem>[]): Promise<void> {
  for (const item of items) {
    if (item.productId && !(await productRepo.isSelectable(tenantId, item.productId))) {
      throw new HttpError(422, "PRODUCT_NOT_SELECTABLE", `product ${item.productId} is not active/enabled and cannot be quoted`);
    }
  }
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

  // QP-003: full quotation document — header + relational line items.
  app.get("/v1/crm/quotations/:id/document", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const headerRows = await scopedRead(async (tx) => tx.execute(sql`
      SELECT ${SELECT_COLUMNS} FROM crm.quotations
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `)) as unknown as Array<Record<string, unknown>>;
    const header = headerRows[0];
    if (!header) throw new HttpError(404, "NOT_FOUND", "quotation not found");

    const rawLines = await scopedRead(async (tx) => tx.execute(sql`
      SELECT id, product_id AS "productId", description, quantity,
             unit_price_minor::text AS "unitPriceMinor", tax_rate_bps AS "taxRateBps",
             line_total_minor::text AS "lineTotalMinor", ordinal
      FROM crm.quotation_line_items
      WHERE tenant_id = ${ctx.tenantId} AND quotation_id = ${id}
      ORDER BY ordinal ASC
    `)) as unknown as Array<{
      id: string; productId: string | null; description: string; quantity: number;
      unitPriceMinor: string; taxRateBps: number; lineTotalMinor: string; ordinal: number;
    }>;

    // F4-02: enrich each line with its NET, TAX (round-half-up) and the CGST/SGST/IGST
    // split decided by place-of-supply vs supplier-state. All BigInt paise, surfaced as
    // strings. The header carries the quotation-level totals + GST summary.
    const placeOfSupply = header.placeOfSupply as string | null;
    const supplierState = header.supplierState as string | null;
    let cgst = 0n;
    let sgst = 0n;
    let igst = 0n;
    const lineItems = rawLines.map((l) => {
      const netMinor = BigInt(l.unitPriceMinor) * BigInt(l.quantity);
      const bps = BigInt(Math.max(0, l.taxRateBps ?? 0));
      const taxMinor = bps === 0n ? 0n : (netMinor * bps + 5000n) / 10000n;
      const split = gstSplit(taxMinor, placeOfSupply, supplierState);
      cgst += split.cgstMinor;
      sgst += split.sgstMinor;
      igst += split.igstMinor;
      return {
        ...l,
        netMinor: netMinor.toString(),
        taxMinor: taxMinor.toString(),
        grandTotalMinor: (netMinor + taxMinor).toString(),
        cgstMinor: split.cgstMinor.toString(),
        sgstMinor: split.sgstMinor.toString(),
        igstMinor: split.igstMinor.toString(),
      };
    });

    return reply.send({
      data: {
        ...header,
        lineItems,
        gstSummary: { cgstMinor: cgst.toString(), sgstMinor: sgst.toString(), igstMinor: igst.toString() },
      },
    });
  });

  app.post("/v1/crm/quotations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);

    await assertProductsSelectable(ctx.tenantId, body.lineItems);
    await assertSingleCurrency(ctx.tenantId, body.currency, body.lineItems);

    const existing = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id FROM crm.quotations
        WHERE tenant_id = ${ctx.tenantId} AND quote_ref = ${body.quoteRef} AND version_number = 1
      `) as unknown as Array<{ id: string }>;
    });
    if (existing.length > 0) {
      throw new HttpError(409, "QUOTE_EXISTS", "a quotation with this reference already exists");
    }

    const quotationId = commandId(ctx, COMMANDS.createQuotation);
    const money = resolveMoney(body.lineItems, body.totalMinor, "0");
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createQuotation(ctx, quotationId, {
        dealId: body.dealId ?? null,
        quoteRef: body.quoteRef,
        templateRef: body.templateRef,
        totalMinor: money.netMinor,
        taxMinor: money.taxMinor,
        grandTotalMinor: money.grandTotalMinor,
        currency: body.currency.toUpperCase(),
        placeOfSupply: body.placeOfSupply ?? null,
        supplierState: body.supplierState ?? null,
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

    if (body.lineItems) await assertProductsSelectable(ctx.tenantId, body.lineItems);

    const source = await loadQuotation(ctx.tenantId, id);

    if (body.lineItems) await assertSingleCurrency(ctx.tenantId, source.currency, body.lineItems);

    const maxRows = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT max(version_number)::int AS "maxVersion"
        FROM crm.quotations
        WHERE tenant_id = ${ctx.tenantId} AND quote_ref = ${source.quoteRef}
      `) as unknown as Array<{ maxVersion: number | null }>;
    });
    const nextVersionNumber = (maxRows[0]?.maxVersion ?? source.versionNumber) + 1;

    const clonedLineItems = body.lineItems ?? (source.lineItems as z.infer<typeof lineItem>[]);
    // F4-01: recompute net/tax/grand from whichever line items apply (new or cloned).
    const money = resolveMoney(clonedLineItems, body.totalMinor, source.totalMinor);
    const newId = commandId(ctx, `${COMMANDS.versionQuotation}:${id}`);

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.versionQuotation(ctx, newId, {
        sourceId: id,
        nextVersionNumber,
        totalMinor: money.netMinor,
        taxMinor: money.taxMinor,
        grandTotalMinor: money.grandTotalMinor,
        placeOfSupply: body.placeOfSupply ?? source.placeOfSupply,
        supplierState: body.supplierState ?? source.supplierState,
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
    // QP-004: an unapproved exception cannot be issued as a final quotation. The effective
    // discount is DERIVED SERVER-SIDE from the line prices vs catalogue reference — client
    // input is never trusted — and compared to the configured threshold. A breach requires
    // an APPROVED discount approval whose recorded level covers the computed discount.
    const discountThreshold = await approvalRepo.getThreshold(ctx.tenantId, "discount");
    if (discountThreshold && discountThreshold.enabled) {
      const computed = effectiveDiscountBps(await approvalRepo.referenceLines(ctx.tenantId, id));
      if (computed > discountThreshold.maxDiscountBps) {
        const approvedLevel = await approvalRepo.latestApprovedDiscountBps(ctx.tenantId, id);
        if (approvedLevel === null || approvedLevel < computed) {
          throw new HttpError(
            422,
            "APPROVAL_REQUIRED",
            `effective discount of ${computed} bps exceeds the ${discountThreshold.maxDiscountBps} bps threshold and has no covering approval`,
          );
        }
      }
    }
    // Any raised exception (of any type) still awaiting a decision also blocks the send.
    if (await approvalRepo.hasPendingLatest(ctx.tenantId, id)) {
      throw new HttpError(422, "APPROVAL_REQUIRED", "this quotation has an approval request awaiting a decision");
    }
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

  // QP-005: convert an ACCEPTED quotation into an order.
  app.post("/v1/crm/quotations/:id/convert-to-order", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const q = await loadQuotation(ctx.tenantId, id);
    if (q.status !== "accepted") {
      throw new HttpError(422, "NOT_ACCEPTED", "only an accepted quotation can be converted to an order");
    }
    const orderRef = `ORD-${q.quoteRef}-v${q.versionNumber}`;
    const orderId = commandId(ctx, `${COMMANDS.convertQuotationToOrder}:${id}`);
    await queue.publish(COMMANDS.convertQuotationToOrder, {
      messageId: orderId, type: COMMANDS.convertQuotationToOrder, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id: orderId, tenantId: ctx.tenantId, quotationId: id, quotationVersion: q.versionNumber,
        dealId: q.dealId, orderRef, totalMinor: q.totalMinor, grandTotalMinor: q.grandTotalMinor, currency: q.currency,
      },
    });
    return reply.code(202).send({ id: orderId, status: "accepted", correlationId: ctx.correlationId });
  });
}

async function loadQuotation(tenantId: string, id: string): Promise<QuotationState> {
  const rows = await scopedRead(async (tx) => {
    return tx.execute(sql`
      SELECT id, quote_ref AS "quoteRef", template_ref AS "templateRef", deal_id AS "dealId",
             version_number AS "versionNumber", status, total_minor::text AS "totalMinor",
             grand_total_minor::text AS "grandTotalMinor",
             currency, place_of_supply AS "placeOfSupply", supplier_state AS "supplierState",
             line_items AS "lineItems", version
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
