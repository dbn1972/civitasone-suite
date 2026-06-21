import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { RiskRow } from "./schema.js";

function mapRiskRow(row: RiskRow) {
  return {
    id: row.id,
    riskCode: row.riskCode,
    title: row.title,
    category: row.category as "financial" | "operational" | "compliance" | "reputational" | "strategic" | "it",
    likelihood: row.likelihood as "rare" | "unlikely" | "possible" | "likely" | "almost_certain",
    impact: row.impact as "negligible" | "minor" | "moderate" | "major" | "catastrophic",
    riskScore: row.riskScore,
    owner: row.ownerRef ?? undefined,
    mitigationStatus: row.mitigationStatus as "not_started" | "in_progress" | "implemented" | "accepted",
    reviewDate: row.reviewDate?.toString(),
    status: row.status as "open" | "mitigated" | "closed" | "escalated",
  };
}

export async function listRisks(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "audit_risk", `list:${limit}`),
    () => repo.listByTenant(tenantId, limit),
  );
  return (rows ?? []).map(mapRiskRow);
}
