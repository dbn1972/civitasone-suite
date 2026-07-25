import * as repo from "./repo.js";

export async function listControls(tenantId: string, riskId: string) {
  const rows = await repo.listControls(tenantId, riskId);
  return {
    items: rows.map((c) => ({
      id: c.id, riskId: c.riskId, controlCode: c.controlCode, description: c.description,
      controlType: c.controlType, owner: c.ownerRef ?? undefined,
      effectiveness: c.effectiveness, status: c.status,
    })),
  };
}

export async function listIncidents(tenantId: string, limit: number) {
  const rows = await repo.listIncidents(tenantId, limit);
  return {
    items: rows.map((i) => ({
      id: i.id, riskId: i.riskId ?? undefined, title: i.title, description: i.description,
      severity: i.severity, status: i.status, occurredAt: i.occurredAt.toISOString(),
    })),
  };
}

export async function listMitigations(tenantId: string, riskId: string) {
  const rows = await repo.listMitigations(tenantId, riskId);
  return {
    items: rows.map((m) => ({
      id: m.id, riskId: m.riskId, action: m.action, owner: m.ownerRef ?? undefined,
      dueDate: m.dueDate ?? undefined, status: m.status,
    })),
  };
}

export async function listAcceptances(tenantId: string, riskId: string) {
  const rows = await repo.listAcceptances(tenantId, riskId);
  return {
    items: rows.map((a) => ({
      id: a.id, riskId: a.riskId, rationale: a.rationale, residualScore: a.residualScore,
      status: a.status, validUntil: a.validUntil ?? undefined,
      requestedBy: a.requestedBy, decidedBy: a.decidedBy ?? undefined,
      decidedAt: a.decidedAt?.toISOString(),
    })),
  };
}

export async function listReviews(tenantId: string, riskId: string) {
  const rows = await repo.listReviews(tenantId, riskId);
  return {
    items: rows.map((r) => ({
      id: r.id, riskId: r.riskId, outcome: r.outcome, notes: r.notes ?? undefined,
      reviewedBy: r.reviewedBy ?? undefined, reviewedAt: r.reviewedAt.toISOString(),
      nextReviewDate: r.nextReviewDate ?? undefined,
    })),
  };
}
