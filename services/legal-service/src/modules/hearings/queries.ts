import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as caseRepo from "../cases/repo.js";

function mapHearingStatus(status: string): "scheduled" | "completed" | "adjourned" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "adjourned") return "adjourned";
  if (status === "cancelled") return "cancelled";
  return "scheduled";
}

export async function listHearingSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "hearings", `list:${limit}`),
    () => repo.listHearingsByTenant(tenantId, limit),
  );
  const summaries = [];
  for (const row of rows ?? []) {
    const legalCase = await caseRepo.findCaseById(row.caseId);
    summaries.push({
      id: row.id,
      caseId: row.caseId,
      caseNo: legalCase?.caseNo ?? row.caseId,
      caseTitle: legalCase?.title ?? "Case",
      court: row.court,
      date: row.hearingDate.toString(),
      purpose: row.purpose ?? undefined,
      nextDate: row.nextDate?.toString(),
      status: mapHearingStatus(row.status),
    });
  }
  return summaries;
}

export async function listOpinionSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "legal_opinions", `list:${limit}`),
    () => repo.listOpinionsByTenant(tenantId, limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    opinionNo: row.opinionNo,
    subject: row.subject,
    requestedBy: row.requestedBy,
    requestDate: row.requestDate.toString(),
    dueDate: row.dueDate?.toString(),
    advisorName: row.advisorName ?? undefined,
    status: (["pending", "draft", "issued", "revised"].includes(row.status) ? row.status : "pending") as "pending" | "draft" | "issued" | "revised",
    issuedDate: row.issuedDate?.toString(),
  }));
}

export async function listCourtOrderSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "court_orders", `list:${limit}`),
    () => repo.listOrdersByTenant(tenantId, limit),
  );
  const summaries = [];
  for (const row of rows ?? []) {
    const legalCase = await caseRepo.findCaseById(row.caseId);
    summaries.push({
      id: row.id,
      caseId: row.caseId,
      caseNo: legalCase?.caseNo ?? row.caseId,
      court: legalCase?.court ?? "Court",
      orderDate: row.orderDate.toString(),
      summary: row.summary,
      complianceRequired: Boolean(row.direction),
      department: row.deptRef ?? undefined,
      status: "pending" as const,
    });
  }
  return summaries;
}
