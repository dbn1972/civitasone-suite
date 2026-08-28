import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { complianceDirections } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type ComplianceDirectionRow    = typeof complianceDirections.$inferSelect;
export type ComplianceDirectionInsert = typeof complianceDirections.$inferInsert;

export async function insertDirection(tx: Writer, row: ComplianceDirectionInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(complianceDirections).values(row).onConflictDoNothing({ target: complianceDirections.id });
}

export async function getDirectionForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number } | undefined> {
  const rows = await tx.select({ status: complianceDirections.status, version: complianceDirections.version })
    .from(complianceDirections)
    .where(and(eq(complianceDirections.tenantId, tenantId), eq(complianceDirections.id, id)))
    .limit(1);
  return rows[0];
}

export async function listByCase(tenantId: string, caseId: string): Promise<ComplianceDirectionRow[]> {
  return scopedRead((tx) => tx.select().from(complianceDirections)
    .where(and(eq(complianceDirections.tenantId, tenantId), eq(complianceDirections.caseId, caseId)))
    .orderBy(desc(complianceDirections.createdAt)));
}

export async function getDirection(tenantId: string, id: string): Promise<ComplianceDirectionRow | undefined> {
  const rows = await scopedRead<ComplianceDirectionRow[]>((tx) => tx.select().from(complianceDirections)
    .where(and(eq(complianceDirections.tenantId, tenantId), eq(complianceDirections.id, id)))
    .limit(1));
  return rows[0];
}

/** Narrow, uncached read for a synchronous pre-check before publishing
 *  updateCompliance -- same {status, version} column set as
 *  getDirectionForUpdate (what the consumer reads inside its own tx). */
export async function getDirectionForPrecheck(tenantId: string, id: string): Promise<{ status: string; version: number } | undefined> {
  const rows = await scopedRead<Array<{ status: string; version: number }>>((tx) => tx
    .select({ status: complianceDirections.status, version: complianceDirections.version })
    .from(complianceDirections)
    .where(and(eq(complianceDirections.tenantId, tenantId), eq(complianceDirections.id, id)))
    .limit(1));
  return rows[0];
}
