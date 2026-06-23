import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { projectMilestoneEvidence } from "../project/schema.js";

export type EvidenceInsert = typeof projectMilestoneEvidence.$inferInsert;
export type EvidenceRow = typeof projectMilestoneEvidence.$inferSelect;

export async function listByMilestone(tenantId: string, milestoneId: string): Promise<EvidenceRow[]> {
  return db.select().from(projectMilestoneEvidence).where(
    and(eq(projectMilestoneEvidence.tenantId, tenantId), eq(projectMilestoneEvidence.milestoneId, milestoneId)),
  );
}

export async function insert(row: EvidenceInsert): Promise<EvidenceRow> {
  const [created] = await db.insert(projectMilestoneEvidence).values(row).returning();
  return created!;
}
