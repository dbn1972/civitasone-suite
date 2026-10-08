import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { BeneficiaryRow } from "./schema.js";

function mapBeneficiaryType(type: string): "individual" | "institution" | "society" | "mission" {
  if (type === "institution") return "institution";
  if (type === "society") return "society";
  if (type === "mission") return "mission";
  return "individual";
}

export async function getBeneficiary(tenantId: string, id: string): Promise<BeneficiaryRow | null> {
  const row = await cache.getOrLoad(
    cache.makeKey(tenantId, "beneficiary", id),
    () => repo.findBeneficiaryById(id, tenantId)
  );
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

/**
 * GAP-GRANTS-GRANTEES-04: single-grantee read for the grantee detail route.
 * Maps the beneficiary row to the GranteeDetail wire shape (bigint income is
 * stringified; the registry has no registration/PAN column yet, so those are
 * null — the UI masks them when present). Returns null when not found.
 */
export async function getGranteeDetail(tenantId: string, id: string) {
  const row = await getBeneficiary(tenantId, id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: mapBeneficiaryType(row.type),
    category: row.category ?? null,
    geography: row.geography ?? null,
    status: row.status,
    incomeAnnualMinor: row.incomeAnnualMinor != null ? row.incomeAnnualMinor.toString() : null,
    registrationNo: null,
    panNo: null,
  };
}

export async function listGranteeSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grantees", `list:${limit}`),
    () => repo.listBeneficiariesByTenant(tenantId, limit),
  );
  const list = rows ?? [];
  // GAP2-GRANTS-GRANTEES-06: real per-grantee metrics (approved grants,
  // completed disbursements in paise, UC compliance) instead of hard-coded 0s.
  const portfolio = await repo.listGranteePortfolio(list.map((r) => r.id), tenantId);
  return list.map((row) => {
    const p = portfolio.get(row.id);
    // UC compliance = validated UC statements / UC statements due. A grantee
    // with nothing due reads as 0% due (not a fabricated figure); one with an
    // overdue (unvalidated) UC reads lower than one fully validated.
    const ucCompliancePct = p && p.ucDue > 0
      ? Math.round((p.ucValidated / p.ucDue) * 1000) / 10
      : 0;
    return {
      id: row.id,
      // GAP2-GRANTS-GRANTEES-07: real stored grantee code (null-safe) — never a
      // UUID fragment. Backfilled for existing rows by migration 0016.
      granteeCode: row.granteeCode ?? "—",
      name: row.name,
      type: mapBeneficiaryType(row.type),
      activeGrants: p?.activeGrants ?? 0,
      totalGrantsReceived: p ? Number(p.totalGrantsReceivedMinor) : 0,
      ucCompliancePct,
    };
  });
}
