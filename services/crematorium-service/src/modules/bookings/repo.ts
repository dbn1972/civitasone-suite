import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { crematoriumBookings, type BookingRow, type BookingInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<BookingRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(crematoriumBookings)
      .where(and(eq(crematoriumBookings.id, id), eq(crematoriumBookings.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; facilityId?: string | undefined; page?: number | undefined; pageSize?: number | undefined; createdBy?: string | undefined } = {},
): Promise<{ rows: BookingRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(crematoriumBookings.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(crematoriumBookings.status, opts.status));
  if (opts.facilityId) conditions.push(eq(crematoriumBookings.facilityId, opts.facilityId));
  // Callers pass this to restrict a non-admin citizen's list view to bookings they
  // themselves created (see bookings/routes.ts) — omitted entirely for staff, who
  // see the full tenant-wide list.
  if (opts.createdBy) conditions.push(eq(crematoriumBookings.createdBy, opts.createdBy));

  const rows = await scopedRead((tx) =>
    tx.select().from(crematoriumBookings)
      .where(and(...conditions))
      .orderBy(desc(crematoriumBookings.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(crematoriumBookings)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertBooking(tx: ScopedTx, row: BookingInsert): Promise<void> {
  await tx.insert(crematoriumBookings).values(row);
}

/**
 * Reserves the next human-facing booking number from a real Postgres SEQUENCE
 * (crematorium.booking_number_seq, see migrations/0002_number_sequences.sql).
 * Replaces the previous `randomInt(1, 999999)` scheme (bookings/consumer.ts),
 * which was cryptographically random but not guaranteed unique — a real
 * birthday-paradox collision risk against booking_number's UNIQUE constraint
 * at moderate volume. Must be called from inside the same transaction that
 * inserts the row (nextval() is guaranteed unique across concurrent callers
 * regardless of transaction outcome, which is what matters here — it is not
 * rolled back if the surrounding transaction aborts, but that only "burns" a
 * number, it never hands out a duplicate). Same fix shape as
 * animal-service's nextComplaintNumber / vendor-service's nextLicenceNumber.
 */
export async function nextBookingNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"crematorium"."booking_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return Number(row!.seq);
}

/**
 * Update a booking's status, atomically guarded by `fromStatuses`: the UPDATE only
 * matches a row whose CURRENT status is still one of `fromStatuses`. This makes the
 * state-machine transition check race-free — unlike a check-then-act pattern (read
 * status, decide, then write), which is vulnerable to two concurrent commands both
 * reading the same pre-mutation status before either write lands. Callers should
 * derive `fromStatuses` from `domain.ts`'s `fromStatusesFor(status)` so the allowed
 * transitions are defined in exactly one place.
 *
 * Returns the updated row (so callers can prime the read cache with fresh data) or
 * null if no row matched — either the id/tenant don't exist, or the booking was no
 * longer in an eligible status (someone else's concurrent command won the race).
 */
export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  fromStatuses: readonly string[],
  updatedBy: string,
  extra?: { slotNumber?: string; completedAt?: Date; paymentRef?: string; feePaid?: boolean },
): Promise<BookingRow | null> {
  // Guard found while writing this service's test suite: drizzle-orm's
  // inArray() throws ("inArray requires at least one value") for an empty
  // array rather than compiling to a condition that simply matches nothing.
  // Every real call site derives fromStatuses from domain.ts's
  // fromStatusesFor(status), which is only ever non-empty for the statuses
  // consumers actually transition TO (confirmed/completed/cancelled), so
  // this was not reachable in practice — but a CAS guard whose contract is
  // "no fromStatuses means nothing can ever match" should fail closed by
  // returning null, not by throwing an unhandled error out of an async
  // queue consumer (see bookings/consumer.ts) for any future caller that
  // hits it.
  if (fromStatuses.length === 0) return null;
  const result = await tx.update(crematoriumBookings)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(extra?.slotNumber ? { slotNumber: extra.slotNumber } : {}),
      ...(extra?.completedAt ? { completedAt: extra.completedAt } : {}),
      ...(extra?.paymentRef ? { paymentRef: extra.paymentRef } : {}),
      ...(extra?.feePaid !== undefined ? { feePaid: extra.feePaid } : {}),
      version: sql`${crematoriumBookings.version} + 1`,
    })
    .where(and(
      eq(crematoriumBookings.id, id),
      eq(crematoriumBookings.tenantId, tenantId),
      inArray(crematoriumBookings.status, fromStatuses as string[]),
    ))
    .returning();
  return result[0] ?? null;
}
