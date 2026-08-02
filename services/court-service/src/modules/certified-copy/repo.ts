import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { certifiedCopies } from "./schema.js";

/** Narrow write surface accepted for the transactional (GUC-scoped) path. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type CertifiedCopyRow    = typeof certifiedCopies.$inferSelect;
export type CertifiedCopyInsert = typeof certifiedCopies.$inferInsert;

export async function insertCopy(tx: Writer, row: CertifiedCopyInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(certifiedCopies).values(row).onConflictDoNothing({ target: certifiedCopies.id });
}

export async function getCopyForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number; feeMinor: bigint } | undefined> {
  const rows = await tx.select({
    status: certifiedCopies.status,
    version: certifiedCopies.version,
    feeMinor: certifiedCopies.feeMinor,
  })
    .from(certifiedCopies)
    .where(and(eq(certifiedCopies.tenantId, tenantId), eq(certifiedCopies.id, id)))
    .limit(1);
  return rows[0];
}

export async function listCopiesByCase(tenantId: string, caseId: string): Promise<CertifiedCopyRow[]> {
  return scopedRead((tx) => tx.select().from(certifiedCopies)
    .where(and(eq(certifiedCopies.tenantId, tenantId), eq(certifiedCopies.caseId, caseId)))
    .orderBy(desc(certifiedCopies.createdAt)));
}

export async function getCopy(tenantId: string, id: string): Promise<CertifiedCopyRow | undefined> {
  const rows = await scopedRead<CertifiedCopyRow[]>((tx) => tx.select().from(certifiedCopies)
    .where(and(eq(certifiedCopies.tenantId, tenantId), eq(certifiedCopies.id, id)))
    .limit(1));
  return rows[0];
}
