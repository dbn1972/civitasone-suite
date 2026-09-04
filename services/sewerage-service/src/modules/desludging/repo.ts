import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { sewerageDesludgingBookings, type BookingRow, type BookingInsert } from "./schema.js";

export function toView(r: BookingRow) {
  return {
    id: r.id, tenantId: r.tenantId, bookingNumber: r.bookingNumber, requestedBy: r.requestedBy,
    address: r.address, tankCapacityLitres: r.tankCapacityLitres,
    requestedDate: r.requestedDate, requestedSlot: r.requestedSlot,
    status: r.status, vehicleId: r.vehicleId,
    // feeMinor is a native JS bigint (drizzle bigint mode) or null — see
    // billing/repo.ts's toView amountMinor comment for why this must never
    // be sent as a raw bigint. `!= null` (not truthy) so a genuine fee of
    // 0n still serializes as "0", not null.
    feeMinor: r.feeMinor != null ? r.feeMinor.toString() : null,
    feePaid: r.feePaid,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<BookingRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageDesludgingBookings).where(and(eq(sewerageDesludgingBookings.id, id), eq(sewerageDesludgingBookings.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(sewerageDesludgingBookings.tenantId, tenantId)];
  if (status) conditions.push(eq(sewerageDesludgingBookings.status, status));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageDesludgingBookings).where(where).orderBy(desc(sewerageDesludgingBookings.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(sewerageDesludgingBookings).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: BookingInsert): Promise<void> {
  await tx.insert(sewerageDesludgingBookings).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<BookingInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(sewerageDesludgingBookings)
    .set({ ...patch, updatedAt: new Date(), version: sql`${sewerageDesludgingBookings.version} + 1` })
    .where(and(eq(sewerageDesludgingBookings.id, id), eq(sewerageDesludgingBookings.tenantId, tenantId), eq(sewerageDesludgingBookings.version, currentVersion)))
    .returning({ id: sewerageDesludgingBookings.id });
  return result.length > 0;
}

// Reserves the next booking number from the DB sequence (migrations/
// 0003_number_sequences.sql), inside the same transaction as the insert.
// Replaces the old `SEWD-${Date.now()}` scheme.
export async function nextBookingNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"civitas_sewerage"."booking_number_seq"')::bigint AS seq`,
  )) as unknown as Array<{ seq: number }>;
  return Number(row!.seq);
}
