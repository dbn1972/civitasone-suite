import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalCases, legalParties, legalCaseTypes, type CaseRow, type CaseInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type CaseTypeRow = typeof legalCaseTypes.$inferSelect;
export type CaseTypeInsert = typeof legalCaseTypes.$inferInsert;

/**
 * GAP-LEGAL-CASES-NEW-01: list a tenant's case-type master, ordered by name.
 * Returns the full rows; the API projects {id, code, name}.
 */
export async function listCaseTypes(tenantId: string): Promise<CaseTypeRow[]> {
  return db.transaction((tx) =>
    tx.select().from(legalCaseTypes)
      .where(eq(legalCaseTypes.tenantId, tenantId))
      .orderBy(legalCaseTypes.name));
}

export async function findCaseTypeByCodeTx(tx: Writer, tenantId: string, code: string): Promise<CaseTypeRow | null> {
  const rows = await (tx as typeof db).select().from(legalCaseTypes)
    .where(and(eq(legalCaseTypes.tenantId, tenantId), eq(legalCaseTypes.code, code)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findCaseTypeByCode(tenantId: string, code: string): Promise<CaseTypeRow | null> {
  return db.transaction((tx) => findCaseTypeByCodeTx(tx, tenantId, code));
}

/** Look up a case type by id within the tenant (for create-case validation). */
export async function findCaseTypeById(tenantId: string, id: string): Promise<CaseTypeRow | null> {
  const rows = await db.transaction((tx) =>
    tx.select().from(legalCaseTypes)
      .where(and(eq(legalCaseTypes.tenantId, tenantId), eq(legalCaseTypes.id, id)))
      .limit(1));
  return rows[0] ?? null;
}

/**
 * Idempotent insert of a case type. ON CONFLICT (tenant_id, code) DO NOTHING
 * so a redelivered create command (or a re-run seed) is a safe no-op — the
 * UNIQUE (tenant_id, code) constraint is the dedup key.
 */
export async function insertCaseType(tx: Writer, row: CaseTypeInsert): Promise<void> {
  await tx.insert(legalCaseTypes).values(row).onConflictDoNothing({
    target: [legalCaseTypes.tenantId, legalCaseTypes.code],
  });
}

export async function findCaseById(id: string): Promise<CaseRow | null> {
  const rows = await db.transaction(async (tx) =>
    tx.select().from(legalCases).where(eq(legalCases.id, id)).limit(1));
  return rows[0] ?? null;
}

/**
 * PERF-019 batch loader: fetches N cases in ONE query instead of one query
 * per id (see hearings/queries.ts::listHearingSummaries/listCourtOrderSummaries
 * and reminders/routes.ts's upcoming-hearings route for the calling pattern
 * this exists to support). Note: findCaseById is NOT tenant-scoped in this
 * repo (case rows are keyed by id only), so neither is this loader — callers
 * already reach a caseId only via a tenant-scoped hearing/order/reminder row.
 */
export async function findCasesByIds(ids: string[]): Promise<CaseRow[]> {
  if (ids.length === 0) return [];
  return db.transaction((tx) => tx.select().from(legalCases).where(inArray(legalCases.id, ids)));
}

export async function findCaseByIdTx(tx: Writer, id: string): Promise<CaseRow | null> {
  const rows = await (tx as typeof db).select().from(legalCases).where(eq(legalCases.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * GAP-LEGAL-CASES-NEW-03: look up a case by its tenant-scoped case number so
 * createCase can reject a duplicate with a synchronous 409 instead of letting
 * the async consumer hit the UNIQUE (tenant_id, case_no) constraint after the
 * API already returned 202 (a silent background failure).
 */
export async function findCaseByTenantAndNo(tenantId: string, caseNo: string): Promise<CaseRow | null> {
  const rows = await db.transaction((tx) =>
    tx.select().from(legalCases)
      .where(and(eq(legalCases.tenantId, tenantId), eq(legalCases.caseNo, caseNo)))
      .limit(1));
  return rows[0] ?? null;
}

export async function insertCase(tx: Writer, row: CaseInsert): Promise<void> {
  await tx.insert(legalCases).values(row);
}

export async function updateCase(tx: Writer, id: string, patch: Partial<CaseInsert>): Promise<void> {
  await tx.update(legalCases).set({ ...patch, updatedAt: new Date() }).where(eq(legalCases.id, id));
}

export async function listCases(tenantId: string, status?: string, caseTypeId?: string, limit = 100): Promise<CaseRow[]> {
  const conditions = [eq(legalCases.tenantId, tenantId)];
  if (status) conditions.push(eq(legalCases.status, status));
  if (caseTypeId) conditions.push(eq(legalCases.caseTypeId, caseTypeId));
  return db.transaction(async (tx) =>
    tx.select().from(legalCases).where(and(...conditions)).limit(limit));
}

/**
 * GAP-LEGAL-CASES-NEW-01: list cases with the resolved case-type CODE attached
 * (`type`) by LEFT JOINing the tenant's case-type master. Both tables live in
 * the same `cases` module schema, so this is an allowed intra-module join (not
 * a cross-module/cross-service join). The web list uses `type` when present and
 * falls back to the caseNo-prefix heuristic when a case has no caseTypeId.
 */
export async function listCasesWithType(
  tenantId: string, status?: string, caseTypeId?: string, limit = 100,
): Promise<Array<CaseRow & { type: string | null }>> {
  const conditions = [eq(legalCases.tenantId, tenantId)];
  if (status) conditions.push(eq(legalCases.status, status));
  if (caseTypeId) conditions.push(eq(legalCases.caseTypeId, caseTypeId));
  return db.transaction(async (tx) =>
    tx.select({
      row: legalCases,
      typeCode: legalCaseTypes.code,
    })
      .from(legalCases)
      .leftJoin(
        legalCaseTypes,
        and(eq(legalCaseTypes.id, legalCases.caseTypeId), eq(legalCaseTypes.tenantId, legalCases.tenantId)),
      )
      .where(and(...conditions))
      .limit(limit)
      .then((rows) => rows.map((r) => ({ ...r.row, type: r.typeCode ?? null }))));
}

export async function insertParty(tx: Writer, row: typeof legalParties.$inferInsert): Promise<void> {
  await tx.insert(legalParties).values(row);
}
