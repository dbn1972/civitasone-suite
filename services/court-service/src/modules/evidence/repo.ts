import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { evidence } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type EvidenceRow    = typeof evidence.$inferSelect;
export type EvidenceInsert = typeof evidence.$inferInsert;

export async function insertEvidence(tx: Writer, row: EvidenceInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(evidence).values(row).onConflictDoNothing({ target: evidence.id });
}

export async function getEvidenceForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number } | undefined> {
  const rows = await tx.select({ status: evidence.status, version: evidence.version })
    .from(evidence)
    .where(and(eq(evidence.tenantId, tenantId), eq(evidence.id, id)))
    .limit(1);
  return rows[0];
}

export async function listByCase(tenantId: string, caseId: string): Promise<EvidenceRow[]> {
  return scopedRead((tx) => tx.select().from(evidence)
    .where(and(eq(evidence.tenantId, tenantId), eq(evidence.caseId, caseId)))
    .orderBy(desc(evidence.createdAt)));
}

export async function getEvidence(tenantId: string, id: string): Promise<EvidenceRow | undefined> {
  const rows = await scopedRead<EvidenceRow[]>((tx) => tx.select().from(evidence)
    .where(and(eq(evidence.tenantId, tenantId), eq(evidence.id, id)))
    .limit(1));
  return rows[0];
}
