import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ObservationRow } from "./schema.js";

function mapObservationType(category: string): "internal" | "cag" | "statutory" | "concurrent" {
  if (category === "cag") return "cag";
  if (category === "statutory") return "statutory";
  if (category === "concurrent") return "concurrent";
  return "internal";
}

function mapSeverity(riskLevel: string): "critical" | "major" | "minor" | "observation" {
  if (riskLevel === "critical" || riskLevel === "high") return "critical";
  if (riskLevel === "major" || riskLevel === "medium") return "major";
  if (riskLevel === "minor" || riskLevel === "low") return "minor";
  return "observation";
}

function mapObservationStatus(status: string): "open" | "replied" | "partially_closed" | "closed" | "compliance_pending" {
  if (status === "replied") return "replied";
  if (status === "partially_closed") return "partially_closed";
  if (status === "closed") return "closed";
  if (status === "compliance_pending") return "compliance_pending";
  return "open";
}

function mapObservationRow(row: ObservationRow) {
  return {
    id: row.id,
    observationNo: row.obsNo,
    title: row.finding.slice(0, 120),
    type: mapObservationType(row.category),
    severity: mapSeverity(row.riskLevel),
    department: row.auditeeRef,
    raisedDate: new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
    status: mapObservationStatus(row.status),
  };
}

export async function getObservation(id: string, tenantId: string): Promise<ObservationRow | null> {
  return cache.getOrLoad<ObservationRow>(
    cache.makeKey(tenantId, "observation", id),
    () => repo.findObservationById(id),
  );
}

export async function listObservationSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "observations", `list:${limit}`),
    () => repo.listObservationsByTenant(tenantId, limit),
  );
  return (rows ?? []).map(mapObservationRow);
}

export async function getObservationDetail(id: string, tenantId: string) {
  const row = await getObservation(id, tenantId);
  if (!row || row.tenantId !== tenantId) return null;
  return { ...mapObservationRow(row), replies: [] };
}
