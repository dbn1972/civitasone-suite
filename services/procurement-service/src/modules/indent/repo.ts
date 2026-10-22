import { eq, and, asc, desc, ilike, inArray, sql } from "drizzle-orm";
import { likePattern } from "../../shared/search.js";
import { db } from "../../shared/db.js";
import { procurementIndents, procurementIndentItems, type IndentRow, type IndentInsert, type IndentItemInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;
/** Executor that can run raw SQL (drizzle db or tx). Mirrors finance-service's
 *  allocation-repo.ts Exec type and po/repo.ts's Executor type. */
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

export async function findIndentById(id: string): Promise<IndentRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementIndents).where(eq(procurementIndents.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function findIndentItemsByIndentId(indentId: string): Promise<(typeof procurementIndentItems.$inferSelect)[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementIndentItems).where(eq(procurementIndentItems.indentId, indentId)));
}

/** Most statuses one list call may ask for (the indent status set is far smaller). */
const MAX_STATUS_FILTER = 10;

/**
 * GAP-PROCUREMENT-DASHBOARD-02: parse the `?status=` filter into the list of
 * raw indent statuses to match. One status or a comma-separated set (the
 * dashboard's "Pending Indents" counter counts `draft` AND `pending`, so its
 * drill-through must be able to ask for both in one paged query). Whitespace
 * and duplicates are dropped; an empty value means "no filter". Unknown values
 * are kept and simply match nothing, so a typo yields an empty list rather than
 * silently returning everything.
 */
export function parseStatusFilter(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_STATUS_FILTER) break;
  }
  return out;
}

/** SQL predicate for a parsed status list (undefined when there is no filter). */
function statusCondition(statuses: string[]) {
  if (statuses.length === 0) return undefined;
  return statuses.length === 1
    ? eq(procurementIndents.status, statuses[0]!)
    : inArray(procurementIndents.status, statuses);
}

export async function findIndentsByTenant(tenantId: string, limit = 100, offset = 0, status?: string, q?: string): Promise<IndentRow[]> {
  const statusCond = statusCondition(parseStatusFilter(status));
  // GAP-PROCUREMENT-ORDERS-NEW-03: optional indent-number search so the PO form's
  // indent picker can reach indents past the first page (same pattern as the
  // vendor / PO searches).
  if (q) {
    const conds = [eq(procurementIndents.tenantId, tenantId), ilike(procurementIndents.indentNo, likePattern(q))];
    if (statusCond) conds.push(statusCond);
    return db.transaction((tx) => tx.select().from(procurementIndents).where(and(...conds))
      .orderBy(asc(procurementIndents.indentNo), asc(procurementIndents.id)).limit(limit).offset(offset));
  }
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  // `status` is a SQL predicate (not a post-filter) so limit/offset page over
  // the matching rows only. The order is explicit (indent number, id as the
  // tiebreak) so successive pages never repeat or skip a row.
  const where = statusCond
    ? and(eq(procurementIndents.tenantId, tenantId), statusCond)
    : eq(procurementIndents.tenantId, tenantId);
  return db.transaction((tx) => tx.select().from(procurementIndents).where(where)
    .orderBy(asc(procurementIndents.indentNo), asc(procurementIndents.id)).limit(limit).offset(offset));
}

/**
 * GAP-PROCUREMENT-INDENTS-05: department-scoped list for a caller who does NOT
 * hold a procurement-wide / oversight role. Least-privilege: a departmental
 * clerk sees only their own department's indents, never the whole tenant's
 * purchase demand (DPDP / least-privilege). Tenant-scoped as well, so RLS and
 * the app-layer predicate agree.
 */
export async function findIndentsByTenantAndDepartment(
  tenantId: string,
  department: string,
  limit = 100,
  offset = 0,
  status?: string,
): Promise<IndentRow[]> {
  const base = and(eq(procurementIndents.tenantId, tenantId), eq(procurementIndents.department, department));
  const statusCond = statusCondition(parseStatusFilter(status));
  return db.transaction((tx) => tx.select().from(procurementIndents)
    .where(statusCond ? and(base, statusCond) : base)
    .orderBy(asc(procurementIndents.indentNo), asc(procurementIndents.id))
    .limit(limit).offset(offset));
}

export async function findIndentByIdTx(tx: Writer, id: string): Promise<IndentRow | null> {
  const rows = await (tx as typeof db).select().from(procurementIndents).where(eq(procurementIndents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertIndent(tx: Writer, row: IndentInsert): Promise<void> {
  await tx.insert(procurementIndents).values(row);
}

export async function updateIndent(tx: Writer, id: string, patch: Partial<IndentInsert>): Promise<void> {
  await tx.update(procurementIndents).set({ ...patch, updatedAt: new Date() }).where(eq(procurementIndents.id, id));
}

export async function insertIndentItems(tx: Writer, items: IndentItemInsert[]): Promise<void> {
  if (items.length) await tx.insert(procurementIndentItems).values(items);
}

/**
 * CRITICAL FIX (indent-budget enforcement): atomic, race-safe reservation of
 * indent budget. Increments committed_minor by deltaMinor ONLY IF the indent
 * (a) belongs to tenantId, (b) is approved, and (c) has enough headroom
 * (total_minor - committed_minor >= deltaMinor) -- all three checked in the
 * SAME guarded UPDATE statement, so the check-and-reserve is one atomic
 * operation with no separate read-then-write race window. Returns true when
 * the reservation was applied, false when the guard rejected it (caller must
 * reject the PO/GeM-order and not write it).
 *
 * Race-safety does not depend on an explicit SELECT ... FOR UPDATE: Postgres
 * itself serialises two concurrent UPDATEs targeting the same row (the
 * second waits for the first's row lock to release at commit/rollback, then
 * re-evaluates its own WHERE clause against the now-current row) -- so two
 * simultaneous callers reserving against the same fresh indent can never
 * both succeed if only one fits within total_minor. This mirrors
 * finance-service's addCommittedGuarded (budget/allocation-repo.ts) exactly:
 * same atomic-UPDATE-as-guard pattern, applied to an indent's own approved
 * ceiling instead of a budget allocation's appropriation. The explicit
 * tenant_id predicate mirrors po/repo.ts's lockPoByIdTx in this same service
 * (defense-in-depth alongside RLS, not a substitute for it) rather than
 * finance's version of this pattern, which omits it.
 */
export async function addIndentCommittedGuarded(
  tx: Exec,
  id: string,
  tenantId: string,
  deltaMinor: bigint,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE indent.procurement_indents
       SET committed_minor = committed_minor + ${deltaMinor}, updated_at = now()
     WHERE id = ${id}::uuid
       AND tenant_id = ${tenantId}::uuid
       AND status = 'approved'
       AND total_minor - committed_minor >= ${deltaMinor}
    RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

export async function findTenderRequiredIndents(tenantId: string, limit = 50): Promise<IndentRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementIndents)
    .where(and(eq(procurementIndents.tenantId, tenantId), eq(procurementIndents.status, "tender_required")))
    .orderBy(desc(procurementIndents.createdAt))
    .limit(limit));
}
