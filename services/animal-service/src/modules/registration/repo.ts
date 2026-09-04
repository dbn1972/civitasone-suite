import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { animalRegistrations, type RegistrationRow, type RegistrationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RegistrationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(animalRegistrations)
      .where(and(eq(animalRegistrations.id, id), eq(animalRegistrations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: RegistrationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(animalRegistrations.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(animalRegistrations.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(animalRegistrations)
      .where(and(...conditions))
      .orderBy(desc(animalRegistrations.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(animalRegistrations)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRegistration(tx: ScopedTx, row: RegistrationInsert): Promise<void> {
  await tx.insert(animalRegistrations).values(row);
}

/**
 * Reserves the next human-facing registration number from a real Postgres
 * SEQUENCE (animal.registration_number_seq, see
 * migrations/0002_number_sequences.sql). Replaces the previous
 * `Date.now() % 999999` scheme -- see complaints/repo.ts's
 * nextComplaintNumber for the full rationale (identical bug, identical fix,
 * mirrored from inspection-service's encroachment/repo.ts).
 */
export async function nextRegistrationNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"animal"."registration_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return Number(row!.seq);
}

/**
 * Atomic compare-and-swap status transition -- see complaints/repo.ts's
 * updateStatus for the full rationale (identical fix, mirrored from
 * refund-service's requests/repo.ts, the fleet reference for this pattern).
 * `allowedFromStatuses` has no default so every call site must pass it
 * explicitly.
 */
export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  allowedFromStatuses: string[],
): Promise<boolean> {
  // See complaints/repo.ts's updateStatus: drizzle's inArray() throws on an
  // empty array instead of matching nothing, so short-circuit here.
  if (allowedFromStatuses.length === 0) return false;
  const result = await tx.update(animalRegistrations)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${animalRegistrations.version} + 1`,
    })
    .where(and(
      eq(animalRegistrations.id, id),
      eq(animalRegistrations.tenantId, tenantId),
      inArray(animalRegistrations.status, allowedFromStatuses),
    ))
    .returning({ id: animalRegistrations.id });
  return result.length > 0;
}
