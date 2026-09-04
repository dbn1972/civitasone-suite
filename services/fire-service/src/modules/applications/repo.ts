import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { fireApplicationsTable } from "./schema.js";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import type { FireApplicationInsert } from "./schema.js";

export async function findById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(fireApplicationsTable)
      .where(and(eq(fireApplicationsTable.tenantId, tenantId), eq(fireApplicationsTable.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; limit?: number | undefined; offset?: number | undefined } = {},
) {
  return scopedRead(async (tx) => {
    const conditions = [eq(fireApplicationsTable.tenantId, tenantId)];
    if (opts.status) conditions.push(eq(fireApplicationsTable.status, opts.status));

    const where = and(...conditions);
    const rows = await tx
      .select()
      .from(fireApplicationsTable)
      .where(where)
      .orderBy(desc(fireApplicationsTable.createdAt))
      .limit(opts.limit ?? 25)
      .offset(opts.offset ?? 0);

    const countResult = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(fireApplicationsTable)
      .where(where);

    return { rows, total: countResult[0]?.total ?? 0 };
  });
}

export async function insert(tx: ScopedTx, data: FireApplicationInsert) {
  const rows = await tx.insert(fireApplicationsTable).values(data).returning();
  return rows[0]!;
}

/**
 * Fleet-wide fix (see migrations/0002_number_sequences.sql): replaces
 * consumer.ts's previous randomInt(1, 999999) draw, which was a real
 * collision risk against application_number's UNIQUE constraint at
 * moderate volume. Called from inside the same transaction that inserts the
 * row, mirroring animal-service's repo.nextComplaintNumber
 * (services/animal-service/src/modules/complaints/repo.ts, PR #1007).
 */
export async function nextApplicationNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"fire_applications"."application_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return Number(row!.seq);
}

export async function updateStatus(
  tx: ScopedTx,
  tenantId: string,
  id: string,
  status: string,
  fromStatuses: readonly string[],
  actorId: string,
) {
  // BUG FIX: drizzle's inArray() THROWS ("inArray requires at least one
  // value") on an empty array rather than compiling to an always-false
  // predicate -- an empty fromStatuses (meaning "no source status is ever
  // valid") must reject the CAS, not crash the consumer. Same guard as
  // animal-service's repo.ts (PR #1007), found the same way: writing the
  // CAS test suite. No current caller passes [] (fromStatusesFor's only
  // call sites are "submitted"/"withdrawn", both of which have real
  // predecessors), but the guard is what fromStatusesFor's own contract —
  // and callers built on top of this exported function — actually promise.
  if (fromStatuses.length === 0) return null;

  const now = new Date();
  const extra: Record<string, unknown> = { updatedAt: now, updatedBy: actorId };
  if (status === "submitted") extra.submittedAt = now;

  const rows = await tx
    .update(fireApplicationsTable)
    .set({ status, version: sql`${fireApplicationsTable.version} + 1`, ...extra })
    .where(and(
      eq(fireApplicationsTable.tenantId, tenantId),
      eq(fireApplicationsTable.id, id),
      inArray(fireApplicationsTable.status, fromStatuses as string[]),
    ))
    .returning();
  return rows[0] ?? null;
}
