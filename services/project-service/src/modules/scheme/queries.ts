import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { SchemeRow } from "./schema.js";

function minorToAmount(minor: bigint): number {
  return Number(minor) / 100;
}

function mapFundingType(type: string): "central" | "state" | "centrally_sponsored" | "external" {
  if (type === "state") return "state";
  if (type === "external") return "external";
  if (type === "css") return "centrally_sponsored";
  return "central";
}

export async function getScheme(id: string, tenantId: string): Promise<SchemeRow | null> {
  return cache.getOrLoad<SchemeRow>(
    cache.makeKey(tenantId, "scheme", id),
    () => repo.findSchemeById(id)
  );
}

export async function listSchemeSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "schemes", `list:${limit}`),
    () => repo.listSchemesByTenant(tenantId, limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    schemeCode: row.code,
    name: row.name,
    fundingType: mapFundingType(row.type),
    totalAllocation: minorToAmount(row.totalOutlayMinor),
    releasedAmount: minorToAmount(row.releasedMinor),
    projectCount: 0,
    status: (row.status === "completed" ? "completed" : row.status === "discontinued" ? "discontinued" : "active") as "active" | "completed" | "discontinued",
  }));
}

export async function listFundReleaseSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "fund_releases", `list:${limit}`),
    () => repo.listFundReleasesByTenant(tenantId, limit),
  );
  const summaries = [];
  for (const row of rows ?? []) {
    const scheme = await repo.findSchemeById(row.schemeId);
    summaries.push({
      id: row.id,
      releaseNo: row.releaseNo,
      projectId: row.schemeId,
      projectName: scheme?.name ?? row.schemeId,
      amount: minorToAmount(row.amountMinor),
      releaseDate: (row.disbursedAt ?? row.createdAt).toISOString().slice(0, 10),
      releasedBy: row.sanctionedBy ?? undefined,
      status: (row.status === "disbursed" ? "released" : row.status === "utilised" ? "utilized" : "sanctioned") as "sanctioned" | "released" | "utilized",
    });
  }
  return summaries;
}
