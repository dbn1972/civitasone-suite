import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as caseRepo from "../cases/repo.js";

function mapHearingStatus(status: string): "scheduled" | "completed" | "adjourned" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "adjourned") return "adjourned";
  if (status === "cancelled") return "cancelled";
  return "scheduled";
}

/**
 * PERF-019: was N+1 — one findCaseById call PER hearing row. Now: the outer
 * list (possibly cache-served) plus exactly 1 batch query total regardless
 * of row count. Response shape and per-row field mapping are unchanged from
 * the original loop.
 */
export async function listHearingSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "hearings", `list:${limit}`),
    () => repo.listHearingsByTenant(tenantId, limit),
  );
  const list = rows ?? [];

  const caseIds = [...new Set(list.map((row) => row.caseId))];
  const cases = await caseRepo.findCasesByIds(caseIds);
  const caseById = new Map(cases.map((c) => [c.id, c]));

  return list.map((row) => {
    const legalCase = caseById.get(row.caseId);
    return {
      id: row.id,
      caseId: row.caseId,
      caseNo: legalCase?.caseNo ?? row.caseId,
      caseTitle: legalCase?.title ?? "Case",
      court: row.court,
      date: row.hearingDate.toString(),
      purpose: row.purpose ?? undefined,
      nextDate: row.nextDate?.toString(),
      status: mapHearingStatus(row.status),
    };
  });
}

/**
 * PERF-019: was N+1 — one findCaseById call PER court-order row. Now: the
 * outer list (possibly cache-served) plus exactly 1 batch query total
 * regardless of row count. Response shape and per-row field mapping are
 * unchanged from the original loop.
 */
export async function listCourtOrderSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "court_orders", `list:${limit}`),
    () => repo.listOrdersByTenant(tenantId, limit),
  );
  const list = rows ?? [];

  const caseIds = [...new Set(list.map((row) => row.caseId))];
  const cases = await caseRepo.findCasesByIds(caseIds);
  const caseById = new Map(cases.map((c) => [c.id, c]));

  return list.map((row) => {
    const legalCase = caseById.get(row.caseId);
    return {
      id: row.id,
      caseId: row.caseId,
      caseNo: legalCase?.caseNo ?? row.caseId,
      court: legalCase?.court ?? "Court",
      orderDate: row.orderDate.toString(),
      orderType: row.orderType,
      summary: row.summary,
      // GAP-LEGAL-COURT-ORDERS-NEW-01: use the recorded compliance fields;
      // legacy rows are backfilled by migration 0027 and the consumer applies
      // the Boolean(direction) fallback at write time.
      complianceRequired: row.complianceRequired,
      complianceDeadline: row.complianceDeadline ? row.complianceDeadline.toString() : undefined,
      department: row.deptRef ?? undefined,
      status: "pending" as const,
    };
  });
}

/**
 * GAP2-LEGAL-COURT-ORDERS-10: page-aware court-order summaries plus the true
 * tenant total and compliance KPIs computed over the FULL set in SQL. The
 * previous list capped at `limit` and the web page then derived "Contempt
 * Risk"/"Orders Tracked" from that ≤50-row slice, undercounting contempt
 * exposure for a legal cell with more than 50 tracked orders. `today` is the
 * caller's IST calendar date used for the overdue comparison.
 */
export async function listCourtOrderSummariesPaged(
  tenantId: string,
  limit: number,
  offset: number,
  today: string,
) {
  const [rows, total, stats] = await Promise.all([
    repo.listOrdersByTenantPaged(tenantId, limit, offset),
    repo.countOrdersByTenant(tenantId),
    repo.aggregateOrderStats(tenantId, today),
  ]);

  const caseIds = [...new Set(rows.map((row) => row.caseId))];
  const cases = await caseRepo.findCasesByIds(caseIds);
  const caseById = new Map(cases.map((c) => [c.id, c]));

  const items = rows.map((row) => {
    const legalCase = caseById.get(row.caseId);
    return {
      id: row.id,
      caseId: row.caseId,
      caseNo: legalCase?.caseNo ?? row.caseId,
      court: legalCase?.court ?? "Court",
      orderDate: row.orderDate.toString(),
      orderType: row.orderType,
      summary: row.summary,
      complianceRequired: row.complianceRequired,
      complianceDeadline: row.complianceDeadline ? row.complianceDeadline.toString() : undefined,
      department: row.deptRef ?? undefined,
      status: "pending" as const,
    };
  });

  return { items, total, limit, offset, stats };
}
