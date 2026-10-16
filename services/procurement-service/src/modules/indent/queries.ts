import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { IndentRow } from "./schema.js";
import { fetchUserSummaries } from "../../shared/identity-client.js";
import { fetchRefDecisions } from "../../shared/workflow-client.js";

// Bug fix (raw-id-leaked-to-ui): indent.procurement_indents has no
// requester_id/requester_name column -- created_by (the indent creator) IS
// the requester, but it's a raw identity-service user uuid, not a display
// name. The frontend used to fall back to slicing the first 8 chars of that
// uuid and showing it as "Requested By", which for every seeded indent here
// happened to render the literal string "00000000" (every seed actor id
// starts with zeros). Resolve it to a real name server-side instead, same
// enrichment shape as payroll-service's getSlip/listSalarySlips resolving
// employeeId via hrms-client's fetchEmployeeSummaries. Falls back to
// undefined (not a raw id) when identity-service doesn't recognize the id
// either (e.g. a placeholder seed actor with no real user record) -- the
// frontend already renders a missing requestedBy as an honest "—".
export type IndentSummaryRow = IndentRow & { requestedBy: string | undefined };

async function withRequestedBy<T extends { createdBy: string }>(
  tenantId: string,
  rows: T[],
): Promise<(T & { requestedBy: string | undefined })[]> {
  // Vacuously satisfies the return type -- there are no elements to be
  // missing the field.
  if (rows.length === 0) return rows as (T & { requestedBy: string | undefined })[];
  const userMap = await fetchUserSummaries(tenantId);
  return rows.map((row) => ({ ...row, requestedBy: userMap.get(row.createdBy)?.name }));
}

export async function getIndent(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const indent = await cache.getOrLoad<IndentRow | null>(
    cache.makeKey(tenantId, "indent", id),
    () => repo.findIndentById(id),
  );
  if (!indent || indent.tenantId !== tenantId) return null;

  const [items, [enriched], trail] = await Promise.all([
    repo.findIndentItemsByIndentId(id),
    withRequestedBy(tenantId, [indent]),
    indentApprovalTrail(tenantId, id),
  ]);
  return {
    ...enriched,
    totalMinor: String(indent.totalMinor),
    lineItems: items.map((i) => ({
      itemCode: i.itemCode,
      itemName: i.description,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unitPriceMinor: Number(i.unitPriceMinor),
      estimatedUnitPrice: Number(i.unitPriceMinor),
      totalPrice: Number(i.unitPriceMinor) * i.quantity,
    })),
    approvalTrail: trail.entries,
    // GAP-PROCUREMENT-INDENTS-DETAIL-05: false = the workflow engine could not
    // be asked, so an empty trail must NOT be read as "never decided".
    approvalTrailAvailable: trail.available,
  };
}

export type ApprovalTrailEntry = { actor: string; action: string; timestamp: string; remarks?: string };

const TRAIL_ACTIONS: Record<string, string> = { complete: "Approved", reject: "Rejected", return: "Returned" };

/**
 * GAP-PROCUREMENT-INDENTS-DETAIL-05: the indent's approval trail, from the
 * decisions the workflow engine recorded (actor, action, time, and the reason
 * given on a rejection / return). The actor is resolved to a display name - a
 * raw user id is never surfaced.
 */
export async function indentApprovalTrail(tenantId: string, indentId: string): Promise<{ available: boolean; entries: ApprovalTrailEntry[] }> {
  const { available, decisions } = await fetchRefDecisions(tenantId, "procurement_indent", indentId);
  if (!available || decisions.length === 0) return { available, entries: [] };
  const users = await fetchUserSummaries(tenantId);
  return {
    available,
    entries: decisions.map((d) => ({
      actor: users.get(d.actorId)?.name ?? "Unknown user",
      action: TRAIL_ACTIONS[d.action] ?? d.action,
      timestamp: d.at,
      ...(d.reason ? { remarks: d.reason } : {}),
    })),
  };
}

export async function listTenderRequiredIndents(tenantId: string, limit = 50): Promise<IndentRow[]> {
  return repo.findTenderRequiredIndents(tenantId, limit);
}

export async function listIndents(tenantId: string, limit = 50, offset = 0, department?: string, status?: string, q?: string): Promise<IndentSummaryRow[]> {
  // GAP-PROCUREMENT-INDENTS-05: when `department` is set the caller lacks a
  // procurement-wide/oversight role, so the list is fenced to their own
  // department (least-privilege). Wide readers pass no department and see all.
  const result = await cache.getOrLoad<IndentRow[]>(
    cache.makeKey(tenantId, "indents", `list:${limit}:${offset}:${department ?? "*"}:${status ?? "*"}:${q ?? "*"}`),
    () => (department
      ? repo.findIndentsByTenantAndDepartment(tenantId, department, limit, offset, status)
      : repo.findIndentsByTenant(tenantId, limit, offset, status, q)),
  );
  return withRequestedBy(tenantId, result ?? []);
}
