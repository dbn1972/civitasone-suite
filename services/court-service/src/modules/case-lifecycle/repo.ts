import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cases, caseStateTransitions } from "../case-registry/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type CaseStateTransitionInsert = typeof caseStateTransitions.$inferInsert;

/** Read the current (status, version) of a case inside the caller's tx, so the
 *  transition check and the version-guarded write see a consistent snapshot. */
export async function getCaseForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number } | undefined> {
  const rows = await tx.select({ status: cases.status, version: cases.version })
    .from(cases)
    .where(and(eq(cases.tenantId, tenantId), eq(cases.id, id)))
    .limit(1);
  return rows[0];
}

export async function appendStateTransition(tx: Writer, row: CaseStateTransitionInsert): Promise<void> {
  await tx.insert(caseStateTransitions).values(row);
}

/** Single-row read for a synchronous pre-check before publishing a status-
 *  change command (mirrors what the consumer reads inside its own tx via
 *  getCaseForUpdate, so the route can reject a foreseeable illegal
 *  transition immediately instead of the caller getting a 202 that
 *  silently dead-letters). Deliberately NOT read-through-cached (unlike
 *  case-registry's getCaseById): a stale cached status/version here would
 *  let this exact pre-check wrongly pass or wrongly reject, reproducing
 *  the fake-202 problem it exists to close. */
export async function getCaseForPrecheck(tenantId: string, id: string): Promise<{ status: string; version: number } | undefined> {
  const rows = await scopedRead<Array<{ status: string; version: number }>>((tx) => tx
    .select({ status: cases.status, version: cases.version })
    .from(cases)
    .where(and(eq(cases.tenantId, tenantId), eq(cases.id, id)))
    .limit(1));
  return rows[0];
}
