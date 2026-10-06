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
  return (rows ?? []).map((row) => ({
    id: row.id,
    granteeCode: row.id.slice(0, 8).toUpperCase(),
    name: row.name,
    type: mapBeneficiaryType(row.type),
    activeGrants: 0,
    totalGrantsReceived: 0,
    ucCompliancePct: 0,
  }));
}
