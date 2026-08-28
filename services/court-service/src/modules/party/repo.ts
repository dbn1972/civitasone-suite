import { eq, and, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
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

/**
 * Narrow, UNCACHED read of a party's current version, for commands.ts's
 * synchronous pre-check BEFORE a command is published (no transaction exists
 * yet at that point, so getPartyForUpdate's tx-scoped signature does not apply
 * here). Mirrors case-parcel/repo.ts's getParcelForPrecheck.
 */
export async function getPartyForPrecheck(
  tenantId: string, id: string,
): Promise<{ version: number } | undefined> {
  const rows = await scopedRead<Array<{ version: number }>>((tx) => tx
    .select({ version: caseParties.version })
    .from(caseParties)
    .where(and(eq(caseParties.tenantId, tenantId), eq(caseParties.id, id)))
    .limit(1));
  return rows[0];
}

/** List a case's parties. The encryptedText columns return CLEARTEXT here — the
 *  route layer masks per role before serialising to the client. */
export async function listPartiesByCase(tenantId: string, caseId: string): Promise<CasePartyRow[]> {
  return scopedRead((tx) => tx.select().from(caseParties)
    .where(and(eq(caseParties.tenantId, tenantId), eq(caseParties.caseId, caseId)))
    // id tiebreaker: parties added together in one case-registration
    // transaction share the same defaultNow() createdAt, so createdAt
    // alone does not guarantee two identical queries agree on order.
    .orderBy(asc(caseParties.createdAt), asc(caseParties.id)));
}
