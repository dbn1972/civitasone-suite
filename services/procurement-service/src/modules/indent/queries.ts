import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { IndentRow } from "./schema.js";
import { fetchUserSummaries } from "../../shared/identity-client.js";

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
  if (rows.length === 0) return rows;
  const userMap = await fetchUserSummaries(tenantId);
  return rows.map((row) => ({ ...row, requestedBy: userMap.get(row.createdBy)?.name }));
}

export async function getIndent(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const indent = await cache.getOrLoad<IndentRow | null>(
    cache.makeKey(tenantId, "indent", id),
    () => repo.findIndentById(id),
  );
  if (!indent || indent.tenantId !== tenantId) return null;

  const [items, [enriched]] = await Promise.all([
    repo.findIndentItemsByIndentId(id),
    withRequestedBy(tenantId, [indent]),
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
    approvalTrail: [],
  };
}

export async function listTenderRequiredIndents(tenantId: string, limit = 50): Promise<IndentRow[]> {
  return repo.findTenderRequiredIndents(tenantId, limit);
}

export async function listIndents(tenantId: string, limit = 50, offset = 0): Promise<IndentSummaryRow[]> {
  const result = await cache.getOrLoad<IndentRow[]>(
    cache.makeKey(tenantId, "indents", `list:${limit}:${offset}`),
    () => repo.findIndentsByTenant(tenantId, limit, offset),
  );
  return withRequestedBy(tenantId, result ?? []);
}
