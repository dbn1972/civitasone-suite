import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { isOverdue, daysRemaining } from "./domain.js";
import type { RtiApplicationRow } from "./schema.js";

function mapApplication(row: RtiApplicationRow, now = new Date()) {
  return {
    id: row.id,
    applicationNo: row.applicationNo,
    applicantName: row.applicantName,
    subject: row.subject,
    pioRef: row.pioRef ?? undefined,
    status: row.status,
    lifeOrLiberty: row.lifeOrLiberty,
    thirdParty: row.thirdParty,
    feePaid: Number(row.feePaid),
    additionalFee: Number(row.additionalFee),
    receivedAt: row.receivedAt.toISOString(),
    deadlineAt: row.deadlineAt.toISOString(),
    daysRemaining: daysRemaining(row.deadlineAt, now),
    overdue: isOverdue(row.deadlineAt, now),
  };
}

export async function listApplications(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "rti", `list:${limit}`),
    () => repo.listByTenant(tenantId, limit),
  );
  const now = new Date();
  return { items: (rows ?? []).map((r) => mapApplication(r, now)) };
}

export async function getApplication(tenantId: string, id: string) {
  const row = await repo.findById(id, tenantId);
  if (!row) return null;
  const appeals = await repo.listAppealsForApplication(id, tenantId);
  return {
    ...mapApplication(row),
    requestText: row.requestText,
    applicantAddr: row.applicantAddr ?? undefined,
    appeals: appeals.map((a) => ({
      id: a.id, tier: a.tier, appellateAuthority: a.appellateAuthority,
      orderStatus: a.orderStatus, filedAt: a.filedAt.toISOString(),
      deadlineAt: a.deadlineAt?.toISOString() ?? null,
      decidedAt: a.decidedAt?.toISOString(),
    })),
  };
}

export async function listDisclosures(tenantId: string, limit: number) {
  const rows = await repo.listDisclosures(tenantId, limit);
  return {
    items: rows.map((r) => ({
      id: r.id, applicationId: r.applicationId ?? undefined,
      category: r.category, description: r.description,
      disclosedAt: r.disclosedAt.toISOString(),
    })),
  };
}
