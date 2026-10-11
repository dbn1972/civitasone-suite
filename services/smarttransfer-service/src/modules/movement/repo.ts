import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { cycles, type CycleRow, type CycleInsert } from "./schema.js";

/**
 * Jurisdiction predicate shared by the list and the by-id read: a caller with
 * jurisdiction claims sees only rows in one of them OR tenant-wide (null) rows;
 * a caller with no claim (tenant-level admin) is unrestricted.
 */
function jurisdictionPredicate(jurisdictionUnitIds: string[] | undefined) {
  if (!jurisdictionUnitIds || jurisdictionUnitIds.length === 0) return undefined;
  return sql`(${cycles.jurisdictionUnitId} IS NULL OR ${inArray(cycles.jurisdictionUnitId, jurisdictionUnitIds)})`;
}

/** Tenant-scoped by-id read (RLS fences the tenant underneath). Apply cycleInScope() for the caller's jurisdiction. */
export async function findCycleById(id: string, tenantId: string): Promise<CycleRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(cycles).where(and(eq(cycles.id, id), eq(cycles.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

/**
 * In-memory twin of jurisdictionPredicate() for rows served from the by-id
 * read-through cache (which is keyed by tenant+id and so cannot carry the
 * caller's scope): same rule as listCycles.
 */
export function cycleInScope(row: CycleRow, jurisdictionUnitIds: string[] | undefined): boolean {
  if (!jurisdictionUnitIds || jurisdictionUnitIds.length === 0) return true;
  return row.jurisdictionUnitId == null || jurisdictionUnitIds.includes(row.jurisdictionUnitId);
}

/**
 * List cycles for a tenant, SCOPED to the caller's jurisdiction (house rule 9:
 * lists are scoped to the caller's jurisdiction). When the caller carries
 * jurisdiction claims, only rows whose `jurisdiction_unit_id` is one of them —
 * OR which are tenant-wide (null scope) — are returned. A caller with NO
 * jurisdiction claim (e.g. a tenant-level administrator) sees all of the
 * tenant's rows. RLS still fences the tenant underneath this.
 */
export async function listCycles(
  tenantId: string,
  opts: {
    status?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
    jurisdictionUnitIds?: string[] | undefined;
  } = {},
): Promise<{ rows: CycleRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(cycles.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(cycles.status, opts.status));
  const j = jurisdictionPredicate(opts.jurisdictionUnitIds);
  if (j) conditions.push(j);

  const rows = await scopedRead((tx) =>
    tx.select().from(cycles).where(and(...conditions)).orderBy(desc(cycles.createdAt)).limit(pageSize).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(cycles).where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertCycle(tx: ScopedTx, row: CycleInsert): Promise<void> {
  await tx.insert(cycles).values(row);
}
