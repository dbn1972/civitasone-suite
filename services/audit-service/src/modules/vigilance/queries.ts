import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { VigilanceCaseRow } from "./schema.js";

/** Summary projection — safe for audit leadership (no evidence/findings bodies). */
function mapSummary(row: VigilanceCaseRow) {
  return {
    id: row.id,
    caseNo: row.caseNo,
    officer: row.officer,
    charges: row.charges,
    stage: row.stage,
    screeningStatus: row.screeningStatus,
    inquiryStatus: row.inquiryStatus,
    outcome: row.outcome,
    confidential: row.confidential,
    assignedIo: row.assignedIo ?? undefined,
  };
}

export async function listVigilanceCases(tenantId: string, limit = 50, offset = 0) {
  const cacheKey = cache.makeKey(tenantId, "vigilance", `list:${limit}:${offset}`);
  return cache.getOrLoad(cacheKey, async () => {
    const items = await repo.listVigilanceCases(tenantId, limit, offset);
    const total = await repo.listVigilanceCasesCount(tenantId);
    return { items: items.map(mapSummary), total, limit, offset };
  });
}

/**
 * Restricted case FILE — the full confidential body (findings, evidence,
 * action recommendations). Callers are role-gated to vigilance roles at the
 * route layer, and RLS tenant-scopes every read here.
 */
export async function getCaseFile(tenantId: string, caseId: string) {
  const row = await repo.findVigilanceCaseById(caseId, tenantId);
  if (!row) return null;
  const [evidence, actions] = await Promise.all([
    repo.listEvidence(caseId, tenantId),
    repo.listActions(caseId, tenantId),
  ]);
  return {
    ...mapSummary(row),
    complaintSource: row.complaintSource ?? undefined,
    findings: row.findings ?? undefined,
    closedAt: row.closedAt?.toISOString(),
    evidence: evidence.map((e) => ({
      id: e.id, kind: e.kind, description: e.description,
      reference: e.reference ?? undefined, collectedBy: e.collectedBy ?? undefined,
      collectedAt: e.collectedAt.toISOString(),
    })),
    actions: actions.map((a) => ({
      id: a.id, recommendation: a.recommendation, recommendedAction: a.recommendedAction,
      status: a.status, remarks: a.remarks ?? undefined,
      proposedBy: a.proposedBy, decidedBy: a.decidedBy ?? undefined,
      decidedAt: a.decidedAt?.toISOString(),
    })),
  };
}
