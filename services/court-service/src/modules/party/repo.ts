import { eq, and, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { caseParties } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type CasePartyRow    = typeof caseParties.$inferSelect;
export type CasePartyInsert = typeof caseParties.$inferInsert;

/** Insert a party. Cleartext passed to nameEnc/addressEnc/phoneEnc/emailEnc is
 *  transparently AES-256-GCM encrypted on write by the encryptedText column type. */
export async function insertParty(tx: Writer, row: CasePartyInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(caseParties).values(row).onConflictDoNothing({ target: caseParties.id });
}

export async function getPartyForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ version: number } | undefined> {
  const rows = await tx.select({ version: caseParties.version })
    .from(caseParties)
    .where(and(eq(caseParties.tenantId, tenantId), eq(caseParties.id, id)))
    .limit(1);
  return rows[0];
}

/** List a case's parties. The encryptedText columns return CLEARTEXT here — the
 *  route layer masks per role before serialising to the client. */
export async function listPartiesByCase(tenantId: string, caseId: string): Promise<CasePartyRow[]> {
  return db.select().from(caseParties)
    .where(and(eq(caseParties.tenantId, tenantId), eq(caseParties.caseId, caseId)))
    .orderBy(asc(caseParties.createdAt));
}
