import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { BeneficiaryRow } from "./schema.js";

function mapBeneficiaryType(type: string): "ngo" | "government" | "institution" | "individual" {
  if (type === "ngo") return "ngo";
  if (type === "government") return "government";
  if (type === "institution") return "institution";
  return "individual";
}

export async function getBeneficiary(tenantId: string, id: string): Promise<BeneficiaryRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "beneficiary", id),
    () => repo.findBeneficiaryById(id)
  );
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
