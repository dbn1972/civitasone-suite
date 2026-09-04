import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { animalComplaints, type ComplaintRow, type ComplaintInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<ComplaintRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(animalComplaints)
      .where(and(eq(animalComplaints.id, id), eq(animalComplaints.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; severity?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: ComplaintRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(animalComplaints.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(animalComplaints.status, opts.status));
  if (opts.severity) conditions.push(eq(animalComplaints.severity, opts.severity));

  const rows = await scopedRead((tx) =>
    tx.select().from(animalComplaints)
      .where(and(...conditions))
      .orderBy(desc(animalComplaints.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(animalComplaints)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertComplaint(tx: ScopedTx, row: ComplaintInsert): Promise<void> {
  await tx.insert(animalComplaints).values(row);
}

/**
 * Reserves the next human-facing complaint number from a real Postgres
 * SEQUENCE (animal.complaint_number_seq, see migrations/0002_number_sequences.sql).
 * Replaces the previous `Date.now() % 999999` scheme, which collided every
 * ~16.7 minutes under load (Date.now() % 999999 repeats on that period) and
 * had nothing at the DB layer forcing uniqueness beyond a UNIQUE constraint
 * that would simply reject the second insert outright. Must be called from
 * inside the same transaction that inserts the row (nextval() is not
 * transactional/rollback-safe in the sense of reusing the number, but it is
 * guaranteed unique across concurrent callers, which is what matters here).
 */
export async function nextComplaintNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"animal"."complaint_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return Number(row!.seq);
}

/**
 * Atomic compare-and-swap status transition.
 *
 * Previously this WHERE clause was id+tenantId only, with no precondition on
 * the row's CURRENT status -- despite already bumping `version` on every
 * call, nothing ever checked it. Two commands racing (e.g. dispatch and
 * close submitted an HTTP round-trip apart, each passing its own route-level
 * pre-check against a `findById` snapshot that was accurate at check time
 * but stale by the time the async consumer actually applies the write) could
 * both pass their pre-check and this function would silently apply whichever
 * one's consumer happened to run last -- a silent no-op-or-clobber, not a
 * rejection.
 *
 * `allowedFromStatuses` makes this an atomic compare-and-swap, mirroring
 * refund-service's requests/repo.ts updateStatus (the fleet reference for
 * this pattern): the row only updates if it is STILL in one of the states
 * this transition is valid from, checked via the returned row count. No
 * default value, so every call site must pass it explicitly and a future
 * caller can't accidentally skip the guard.
 */
export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  allowedFromStatuses: string[],
  extra?: { assignedTo?: string; assignedTeam?: string; resolvedAt?: Date; resolution?: string },
): Promise<boolean> {
  // drizzle's inArray() throws ("inArray requires at least one value") on
  // an empty array rather than compiling to an always-false predicate, so
  // an empty allowedFromStatuses -- a legitimate way for a caller to say
  // "no source status is ever valid for this transition" -- must be
  // short-circuited here instead of reaching the query builder.
  if (allowedFromStatuses.length === 0) return false;
  const result = await tx.update(animalComplaints)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(extra?.assignedTo ? { assignedTo: extra.assignedTo } : {}),
      ...(extra?.assignedTeam ? { assignedTeam: extra.assignedTeam } : {}),
      ...(extra?.resolvedAt ? { resolvedAt: extra.resolvedAt } : {}),
      ...(extra?.resolution ? { resolution: extra.resolution } : {}),
      version: sql`${animalComplaints.version} + 1`,
    })
    .where(and(
      eq(animalComplaints.id, id),
      eq(animalComplaints.tenantId, tenantId),
      inArray(animalComplaints.status, allowedFromStatuses),
    ))
    .returning({ id: animalComplaints.id });
  return result.length > 0;
}
