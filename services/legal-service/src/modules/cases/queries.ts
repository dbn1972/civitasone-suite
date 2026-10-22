import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as hearingRepo from "../hearings/repo.js";
import type { CaseRow } from "./schema.js";

export async function getCase(id: string, tenantId: string): Promise<CaseRow | null> {
  const row = await cache.getOrLoad<CaseRow>(
    cache.makeKey(tenantId, "case", id),
    () => repo.findCaseById(id, tenantId),
  );
  // Defence in depth: never serve a row that belongs to another tenant, even
  // from a poisoned/mis-keyed cache entry.
  if (row && row.tenantId !== tenantId) return null;
  return row;
}

const KNOWN_TYPES = ["civil", "criminal", "arbitration", "tribunal", "writ", "appeal", "other"] as const;
type CaseKind = (typeof KNOWN_TYPES)[number];

function resolveKind(typeCode: string | null, caseNo: string): CaseKind {
  const code = typeCode?.toLowerCase();
  if (code) return (KNOWN_TYPES as readonly string[]).includes(code) ? (code as CaseKind) : "other";
  const no = caseNo.toUpperCase();
  if (no.startsWith("WP") || no.includes("WRIT")) return "writ";
  if (no.includes("ARB")) return "arbitration";
  return "other";
}

const dateOnly = (d: { toString(): string } | null | undefined): string | undefined =>
  d ? d.toString().slice(0, 10) : undefined;

/**
 * The documented case-detail shape the web `LegalCaseDetailSchema` validates:
 * the raw `legal_cases` row mapped to display fields (type, filedDate,
 * advocateName, nextHearingDate, …) plus this case's hearings and orders,
 * all tenant-scoped. Nulls are omitted, never sent.
 */
export async function getCaseDetail(id: string, tenantId: string) {
  const row = await getCase(id, tenantId);
  if (!row) return null;
  const [caseType, respondents, hearings, orders] = await Promise.all([
    row.caseTypeId ? repo.findCaseTypeById(tenantId, row.caseTypeId) : Promise.resolve(null),
    repo.listRespondentNames(tenantId, row.id),
    hearingRepo.listHearingsByCase(tenantId, row.id),
    hearingRepo.listOrdersByCase(tenantId, row.id),
  ]);
  return {
    id: row.id,
    caseNo: row.caseNo,
    title: row.title,
    court: row.court,
    type: resolveKind(caseType?.code ?? null, row.caseNo),
    subject: row.subject ?? undefined,
    filedDate: // The cache serialises rows, so createdAt may be an ISO string on a hit.
    new Date(row.createdAt).toISOString().slice(0, 10),
    petitioner: row.petitioner ?? undefined,
    respondent: respondents.length > 0 ? respondents.join(", ") : undefined,
    advocateName: row.counselRef ?? undefined,
    nextHearingDate: dateOnly(row.nextDate),
    status: row.status,
    // The page labels this "Description": the free-text dispute description.
    description: row.subject ?? undefined,
    hearings: hearings.map((h) => ({
      id: h.id,
      date: dateOnly(h.hearingDate) as string,
      court: h.court,
      purpose: h.purpose ?? undefined,
      nextDate: dateOnly(h.nextDate),
    })),
    orders: orders.map((o) => ({
      id: o.id,
      date: dateOnly(o.orderDate) as string,
      orderType: o.orderType,
      summary: o.summary,
      complianceRequired: o.complianceRequired,
      complianceDeadline: dateOnly(o.complianceDeadline),
      status: "pending" as const,
    })),
  };
}

export async function listCases(tenantId: string, status?: string, caseTypeId?: string) {
  const cacheKey = cache.makeKey(tenantId, "cases", `${status ?? "all"}:${caseTypeId ?? "all"}`);
  // GAP-LEGAL-CASES-NEW-01: resolve the case-type CODE (`type`) so the web list
  // classifies by the explicit type when present (caseNo-prefix heuristic is the
  // web-side fallback for legacy cases with no caseTypeId).
  return cache.getOrLoad(cacheKey, () => repo.listCasesWithType(tenantId, status, caseTypeId));
}

/**
 * GAP-LEGAL-CASES-NEW-01: list the tenant's case-type master, projected to the
 * {id, code, name} the web create-case select and the list classification use.
 */
export async function listCaseTypes(tenantId: string): Promise<Array<{ id: string; code: string; name: string }>> {
  const cacheKey = cache.makeKey(tenantId, "case_types", "all");
  const rows = await cache.getOrLoad(cacheKey, () => repo.listCaseTypes(tenantId));
  return (rows ?? []).map((r) => ({ id: r.id, code: r.code, name: r.name }));
}
