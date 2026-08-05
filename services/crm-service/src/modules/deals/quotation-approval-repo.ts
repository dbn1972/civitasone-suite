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
 * QP-004 send-gate: does this quotation have any exception that is NOT approved?
 * A pending or rejected approval blocks issuing the quotation as final.
 */
export async function hasBlockingApproval(tenantId: string, quotationId: string): Promise<boolean> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT 1 AS blocking FROM crm.quotation_approvals
    WHERE tenant_id = ${tenantId} AND quotation_id = ${quotationId} AND status IN ('pending','rejected')
    LIMIT 1
  `)) as unknown as Array<{ blocking: number }>;
  return rows.length > 0;
}
