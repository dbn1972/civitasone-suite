/**
 * Quotation-approval + threshold reads (QP-004). Raw SQL under tenant RLS.
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import type { ApprovalType } from "./quotation-approval-domain.js";

export interface ThresholdRow {
  approvalType: ApprovalType;
  maxDiscountBps: number;
  requiresRole: string;
  enabled: boolean;
}

export async function getThreshold(tenantId: string, type: ApprovalType): Promise<ThresholdRow | null> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT approval_type AS "approvalType", max_discount_bps AS "maxDiscountBps",
           requires_role AS "requiresRole", enabled
    FROM crm.approval_thresholds
    WHERE tenant_id = ${tenantId} AND approval_type = ${type}
  `)) as unknown as ThresholdRow[];
  return rows[0] ?? null;
}

export interface ApprovalRow {
  id: string;
  quotationId: string;
  approvalType: string;
  status: string;
  thresholdBreached: unknown;
  reason: string | null;
  requestedBy: string;
  approver: string | null;
  version: number;
}

export async function findApproval(tenantId: string, id: string): Promise<ApprovalRow | null> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT id, quotation_id AS "quotationId", approval_type AS "approvalType", status,
           threshold_breached AS "thresholdBreached", reason, requested_by AS "requestedBy",
           approver, version
    FROM crm.quotation_approvals WHERE id = ${id} AND tenant_id = ${tenantId}
  `)) as unknown as ApprovalRow[];
  return rows[0] ?? null;
}

/**
 * QP-004 maker≠checker (F3-01): the actor who created the quotation. Returned so the
 * decide route can forbid self-approval by the quotation's creator as well as by the
 * person who raised the approval request. NULL when the row carries no creator.
 */
export async function quotationCreatedBy(tenantId: string, quotationId: string): Promise<string | null> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT created_by AS "createdBy"
    FROM crm.quotations WHERE id = ${quotationId} AND tenant_id = ${tenantId}
  `)) as unknown as Array<{ createdBy: string | null }>;
  return rows[0]?.createdBy ?? null;
}

export async function listApprovals(tenantId: string, quotationId: string): Promise<ApprovalRow[]> {
  return scopedRead(async (tx) => tx.execute(sql`
    SELECT id, quotation_id AS "quotationId", approval_type AS "approvalType", status,
           threshold_breached AS "thresholdBreached", reason, requested_by AS "requestedBy",
           approver, version
    FROM crm.quotation_approvals WHERE tenant_id = ${tenantId} AND quotation_id = ${quotationId}
    ORDER BY created_at ASC
  `)) as unknown as ApprovalRow[];
}

/**
 * QP-004 send-gate input: each line'\''s quoted unit price alongside its reference
 * (catalogue) unit price, so the effective discount can be derived server-side. A line
 * with no product link has a NULL reference and cannot be scored as a discount.
 *
 * The reference is the product catalogue price (crm.products.price_minor). Price-book
 * overrides are not applied here because the quotation carries no book-selection criteria
 * (segment/geography/channel) — see the deferred note in the module.
 */
export interface ReferenceLineRow {
  refUnitMinor: string | null;
  unitPriceMinor: string;
  quantity: number;
}

export async function referenceLines(tenantId: string, quotationId: string): Promise<ReferenceLineRow[]> {
  // GAP-CRM-QUOTATIONS-05 (owner decision C8): the reference is the PRICE-BOOK price. The book
  // is the highest-priority enabled book in the quotation currency with no segment /
  // geography / channel restriction (a quotation carries no selection criteria, so only a
  // general book can apply to it). A product the book does not price falls back to its
  // catalogue price; a line with no product link has no reference and is never scored.
  return scopedRead(async (tx) => tx.execute(sql`
    SELECT COALESCE(pbi.price_minor, p.price_minor)::text AS "refUnitMinor",
           li.unit_price_minor::text AS "unitPriceMinor",
           li.quantity
    FROM crm.quotation_line_items li
    JOIN crm.quotations q ON q.id = li.quotation_id AND q.tenant_id = li.tenant_id
    LEFT JOIN crm.products p ON p.id = li.product_id AND p.tenant_id = li.tenant_id
    LEFT JOIN LATERAL (
      SELECT pb.id FROM crm.price_books pb
      WHERE pb.tenant_id = li.tenant_id AND pb.enabled = true AND pb.currency = q.currency
        AND pb.segment IS NULL AND pb.geography IS NULL AND pb.channel IS NULL
      ORDER BY pb.priority DESC, pb.name ASC, pb.id ASC
      LIMIT 1
    ) book ON true
    LEFT JOIN crm.price_book_items pbi
      ON pbi.price_book_id = book.id AND pbi.product_id = li.product_id AND pbi.tenant_id = li.tenant_id
    WHERE li.tenant_id = ${tenantId} AND li.quotation_id = ${quotationId}
  `)) as unknown as ReferenceLineRow[];
}

/**
 * C8 create-time warning input: the reference (price-book, else catalogue) unit price for each
 * given product in a currency, using the same general-book rule as referenceLines. Products
 * with no price anywhere are simply absent from the map.
 */
export async function referenceUnitPrices(
  tenantId: string,
  currency: string,
  productIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (productIds.length === 0) return out;
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT p.id AS "productId", COALESCE(pbi.price_minor, p.price_minor)::text AS "refUnitMinor"
    FROM crm.products p
    LEFT JOIN LATERAL (
      SELECT pb.id FROM crm.price_books pb
      WHERE pb.tenant_id = p.tenant_id AND pb.enabled = true AND pb.currency = ${currency}
        AND pb.segment IS NULL AND pb.geography IS NULL AND pb.channel IS NULL
      ORDER BY pb.priority DESC, pb.name ASC, pb.id ASC
      LIMIT 1
    ) book ON true
    LEFT JOIN crm.price_book_items pbi
      ON pbi.price_book_id = book.id AND pbi.product_id = p.id AND pbi.tenant_id = p.tenant_id
    WHERE p.tenant_id = ${tenantId} AND p.id IN (${sql.join(productIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)) as unknown as Array<{ productId: string; refUnitMinor: string | null }>;
  for (const r of rows) if (r.refUnitMinor !== null) out.set(r.productId, r.refUnitMinor);
  return out;
}

/**
 * MEDIUM-4 supersede: the status of the LATEST approval of a given type for a quotation
 * (a newer request supersedes an older decision). Null when none exists.
 */
export async function latestStatusForType(tenantId: string, quotationId: string, type: ApprovalType): Promise<string | null> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT status FROM crm.quotation_approvals
    WHERE tenant_id = ${tenantId} AND quotation_id = ${quotationId} AND approval_type = ${type}
    ORDER BY created_at DESC, version DESC
    LIMIT 1
  `)) as unknown as Array<{ status: string }>;
  return rows[0]?.status ?? null;
}

/** The recorded (server-computed) discount level of the latest APPROVED discount approval. */
export async function latestApprovedDiscountBps(tenantId: string, quotationId: string): Promise<number | null> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT (threshold_breached->>'discountBps')::int AS "discountBps"
    FROM crm.quotation_approvals
    WHERE tenant_id = ${tenantId} AND quotation_id = ${quotationId}
      AND approval_type = 'discount' AND status = 'approved'
    ORDER BY created_at DESC, version DESC
    LIMIT 1
  `)) as unknown as Array<{ discountBps: number | null }>;
  const v = rows[0]?.discountBps;
  return v === undefined || v === null ? null : v;
}

/**
 * QP-004 pending-gate: does ANY approval type currently have its LATEST row pending?
 * A raised exception awaiting decision blocks the send; a superseded (older) pending row
 * does not, because only the latest per type is considered.
 */
export async function hasPendingLatest(tenantId: string, quotationId: string): Promise<boolean> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT 1 AS pending FROM (
      SELECT DISTINCT ON (approval_type) status
      FROM crm.quotation_approvals
      WHERE tenant_id = ${tenantId} AND quotation_id = ${quotationId}
      ORDER BY approval_type, created_at DESC, version DESC
    ) latest
    WHERE latest.status = 'pending'
    LIMIT 1
  `)) as unknown as Array<{ pending: number }>;
  return rows.length > 0;
}
