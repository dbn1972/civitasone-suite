import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsQualificationRequirements, type QualRequirementRow, type QualRequirementInsert } from "./qualification-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function affectedRows(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

export async function findByJob(tenantId: string, jobOpeningId: string): Promise<QualRequirementRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsQualificationRequirements)
    .where(and(eq(hrmsQualificationRequirements.tenantId, tenantId), eq(hrmsQualificationRequirements.jobOpeningId, jobOpeningId))).limit(1));
  return rows[0] ?? null;
}

export async function insertRequirement(tx: Writer, row: QualRequirementInsert): Promise<void> {
  await tx.insert(hrmsQualificationRequirements).values(row);
}

export async function updateRequirement(tx: Writer, tenantId: string, jobOpeningId: string, patch: Partial<QualRequirementInsert>, expectedVersion: number): Promise<void> {
  const res = await tx.update(hrmsQualificationRequirements)
    .set({ ...patch, version: sql`${hrmsQualificationRequirements.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsQualificationRequirements.tenantId, tenantId), eq(hrmsQualificationRequirements.jobOpeningId, jobOpeningId), eq(hrmsQualificationRequirements.version, expectedVersion)));
  if (affectedRows(res) === 0) throw new HttpError(409, "VERSION_CONFLICT", "requirement was modified by another request; reload and retry");
}
