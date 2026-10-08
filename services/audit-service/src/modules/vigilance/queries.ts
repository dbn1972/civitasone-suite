import type { RequestContext } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, SERVICE } from "../../topics.js";
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

/** Fields of a vigilance case that may be revealed through the audited endpoint. */
export const REVEALABLE_FIELDS = ["officer", "charges"] as const;
export type RevealableField = (typeof REVEALABLE_FIELDS)[number];

export interface RevealResult {
  caseId: string;
  field: RevealableField;
  value: string;
}

/**
 * GAP-AUDIT-VIGILANCE-02 (DPDP): read one confidential field (officer identity
 * or charge text — disciplinary data) of a vigilance case AND write a
 * `vigilance_reveal` audit event in the SAME transaction, so a reveal either
 * produces a value AND leaves an audit record, or neither. The audit payload
 * carries the caseId, the field name and the caller-supplied reason only —
 * never the revealed value itself. Role-gating happens at the route layer
 * (PII reader roles); RLS tenant-scopes the read here.
 */
export async function revealCaseField(
  ctx: RequestContext,
  caseId: string,
  field: RevealableField,
  reason: string,
): Promise<RevealResult | null> {
  return db.transaction(async (tx) => {
    const row = await repo.findByIdTx(tx, caseId, ctx.tenantId);
    if (!row) return null;
    const value = field === "officer" ? row.officer : row.charges;
    await enqueue(tx, {
      topic: CONSUMED_EVENTS.auditEventRecord,
      eventType: CONSUMED_EVENTS.auditEventRecord,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      // No PII in the payload — field name + reason only (DPDP accountability).
      payload: {
        service: SERVICE,
        action: "vigilance_reveal",
        resourceType: "vigilance_case",
        resourceId: caseId,
        outcome: "success",
        newValue: { field, reason },
      },
    });
    return { caseId, field, value };
  });
}
