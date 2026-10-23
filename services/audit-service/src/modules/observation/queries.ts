import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { toReadModelStatus } from "./domain.js";
import type { ObservationRow } from "./schema.js";

function mapObservationType(category: string): "internal" | "cag" | "statutory" | "concurrent" {
  if (category === "cag") return "cag";
  if (category === "statutory") return "statutory";
  if (category === "concurrent") return "concurrent";
  return "internal";
}

// Round-trips exactly with the web labels (apps/web/src/lib/audit/observationLabels.ts):
//   critical -> "Critical", major -> "High", minor -> "Medium", observation -> "Low".
// So the write-side risk levels map high->major, medium->minor, low->observation
// (previously high->critical / medium->major / low->minor, which showed a logged
// "High" as "Critical").
export function mapSeverity(riskLevel: string): "critical" | "major" | "minor" | "observation" {
  if (riskLevel === "critical") return "critical";
  if (riskLevel === "major" || riskLevel === "high") return "major";
  if (riskLevel === "minor" || riskLevel === "medium") return "minor";
  return "observation";
}

type Extras = { auditPeriod?: string | undefined; para?: string | undefined };

function formatPeriod(p: { from: string; to: string } | undefined): string | undefined {
  return p ? `${p.from} to ${p.to}` : undefined;
}

function mapObservationRow(row: ObservationRow, extras: Extras = {}) {
  return {
    id: row.id,
    observationNo: row.obsNo,
    title: row.finding.slice(0, 120),
    type: mapObservationType(row.category),
    severity: mapSeverity(row.riskLevel),
    department: row.auditeeRef,
    auditPeriod: extras.auditPeriod,
    raisedDate: new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
    dueDate: row.dueDate ?? undefined,
    status: toReadModelStatus(row.status),
    para: extras.para,
    // PAISE (minor units) — the web formatMoney() contract.
    amount: Number(row.amountInvolvedMinor ?? 0n),
  };
}

async function loadExtras(tenantId: string, rows: ObservationRow[]): Promise<Map<string, Extras>> {
  const planIds = [...new Set(rows.map((r) => r.planId).filter((x): x is string => !!x))];
  const [periods, paras] = await Promise.all([
    repo.lookupPlanPeriods(tenantId, planIds),
    repo.lookupParaNumbers(tenantId, rows.map((r) => r.id)),
  ]);
  const out = new Map<string, Extras>();
  for (const r of rows) {
    out.set(r.id, {
      auditPeriod: formatPeriod(r.planId ? periods.get(r.planId) : undefined),
      para: paras.get(r.id),
    });
  }
  return out;
}

export async function getObservation(id: string, tenantId: string): Promise<ObservationRow | null> {
  return cache.getOrLoad<ObservationRow>(
    cache.makeKey(tenantId, "observation", id),
    () => repo.findObservationById(id, tenantId),
  );
}

export async function listObservationSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "observations", `list:${limit}`),
    () => repo.listObservationsByTenant(tenantId, limit),
  );
  const list = rows ?? [];
  const extras = await loadExtras(tenantId, list);
  return list.map((r) => mapObservationRow(r, extras.get(r.id)));
}

export async function getObservationDetail(id: string, tenantId: string) {
  const row = await getObservation(id, tenantId);
  if (!row || row.tenantId !== tenantId) return null;
  const [extras, replies] = await Promise.all([
    loadExtras(tenantId, [row]),
    repo.listReplies(id, tenantId),
  ]);
  return {
    ...mapObservationRow(row, extras.get(row.id)),
    description: row.finding,
    replies: replies.map((r) => ({
      id: r.id,
      repliedBy: r.respondedByRef,
      content: r.replyText,
      repliedAt: new Date(r.createdAt as unknown as string).toISOString(),
      acceptedByAuditor: r.decision == null ? undefined : r.decision === "accepted",
    })),
  };
}
