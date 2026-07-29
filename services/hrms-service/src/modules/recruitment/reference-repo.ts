import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  hrmsCandidates, hrmsCandidateReferences,
  type CandidateInsert, type ReferenceRow, type ReferenceInsert,
} from "./candidate-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

/** Patch candidate profile fields (reservation attributes / relationship declaration). */
export async function updateCandidateFields(tx: Writer, tenantId: string, id: string, patch: Partial<CandidateInsert>): Promise<void> {
  await tx.update(hrmsCandidates)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.id, id)));
}

/** Full replacement of a candidate's references (delete then insert), in one txn. */
export async function setReferences(tx: Writer, tenantId: string, candidateId: string, rows: ReferenceInsert[]): Promise<void> {
  await tx.delete(hrmsCandidateReferences)
    .where(and(eq(hrmsCandidateReferences.tenantId, tenantId), eq(hrmsCandidateReferences.candidateId, candidateId)));
  if (rows.length > 0) await tx.insert(hrmsCandidateReferences).values(rows);
}

export async function listReferences(tenantId: string, candidateId: string): Promise<ReferenceRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCandidateReferences)
    .where(and(eq(hrmsCandidateReferences.tenantId, tenantId), eq(hrmsCandidateReferences.candidateId, candidateId))));
}
