import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cases, caseParties, caseStateTransitions } from "./schema.js";

/** Narrow write surface accepted for the transactional (GUC-scoped) path. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type CaseRow                  = typeof cases.$inferSelect;
export type CaseInsert               = typeof cases.$inferInsert;
export type CasePartyRow             = typeof caseParties.$inferSelect;
export type CasePartyInsert          = typeof caseParties.$inferInsert;
export type CaseStateTransitionInsert = typeof caseStateTransitions.$inferInsert;

export async function insertCase(tx: Writer, row: CaseInsert): Promise<void> {
  await tx.insert(cases).values(row);
}

export async function insertParties(tx: Writer, rows: CasePartyInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(caseParties).values(rows);
}

export async function insertStateTransition(tx: Writer, row: CaseStateTransitionInsert): Promise<void> {
  await tx.insert(caseStateTransitions).values(row);
}

/**
 * Tenant-scoped list with optional status/court filters, newest-first. The
 * tenant predicate is always applied so a forged filter cannot widen the scan
 * beyond the caller's tenant.
 */
export async function listCases(
  filters: { tenantId: string; status?: string | undefined; courtId?: string | undefined },
  limit: number,
  offset: number,
): Promise<CaseRow[]> {
  const predicates = [eq(cases.tenantId, filters.tenantId)];
  if (filters.status) predicates.push(eq(cases.status, filters.status));
  if (filters.courtId) predicates.push(eq(cases.courtId, filters.courtId));
  return db.select().from(cases)
    .where(and(...predicates))
    .orderBy(desc(cases.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getCaseById(id: string): Promise<CaseRow | null> {
  const rows = await db.select().from(cases).where(eq(cases.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getCasePartiesByCaseId(caseId: string): Promise<CasePartyRow[]> {
  return db.select().from(caseParties).where(eq(caseParties.caseId, caseId));
}
