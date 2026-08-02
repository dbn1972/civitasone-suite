import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { projectMilestoneEvidence } from "../project/schema.js";

export type EvidenceInsert = typeof projectMilestoneEvidence.$inferInsert;
export type EvidenceRow = typeof projectMilestoneEvidence.$inferSelect;

export async function listByMilestone(tenantId: string, milestoneId: string): Promise<EvidenceRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(projectMilestoneEvidence).where(
    and(eq(projectMilestoneEvidence.tenantId, tenantId), eq(projectMilestoneEvidence.milestoneId, milestoneId)),
  ));
}

export async function insertTx(tx: Pick<typeof db, "insert">, row: EvidenceInsert): Promise<EvidenceRow> {
  const [created] = await tx.insert(projectMilestoneEvidence).values(row).returning();
  return created!;
}

export async function insert(row: EvidenceInsert): Promise<EvidenceRow> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this write — a bare db.insert() runs with no RLS GUC set.
  const [created] = await db.transaction((tx) => tx.insert(projectMilestoneEvidence).values(row).returning());
  return created!;
}
