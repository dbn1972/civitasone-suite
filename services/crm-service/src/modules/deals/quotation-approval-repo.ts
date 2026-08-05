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
  return scopedRead(async (tx) => tx.execute(sql`
    SELECT p.price_minor::text AS "refUnitMinor",
           li.unit_price_minor::text AS "unitPriceMinor",
           li.quantity
    FROM crm.quotation_line_items li
    LEFT JOIN crm.products p ON p.id = li.product_id AND p.tenant_id = li.tenant_id
    WHERE li.tenant_id = ${tenantId} AND li.quotation_id = ${quotationId}
  `)) as unknown as ReferenceLineRow[];
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
