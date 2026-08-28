import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { parkingPasses, type PassRow, type PassInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<PassRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(parkingPasses)
      .where(and(eq(parkingPasses.id, id), eq(parkingPasses.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; facilityId?: string | undefined; page?: number | undefined; pageSize?: number | undefined; createdBy?: string | undefined } = {},
): Promise<{ rows: PassRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(parkingPasses.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(parkingPasses.status, opts.status));
  if (opts.facilityId) conditions.push(eq(parkingPasses.facilityId, opts.facilityId));
  if (opts.createdBy) conditions.push(eq(parkingPasses.createdBy, opts.createdBy));

  const rows = await scopedRead((tx) =>
    tx.select().from(parkingPasses)
      .where(and(...conditions))
      .orderBy(desc(parkingPasses.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(parkingPasses)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertPass(tx: ScopedTx, row: PassInsert): Promise<void> {
  await tx.insert(parkingPasses).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  fromStatuses: readonly string[],
  updatedBy: string,
): Promise<PassRow | null> {
  const result = await tx.update(parkingPasses)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${parkingPasses.version} + 1`,
    })
    .where(and(
      eq(parkingPasses.id, id),
      eq(parkingPasses.tenantId, tenantId),
      inArray(parkingPasses.status, fromStatuses as string[]),
    ))
    .returning();
  return result[0] ?? null;
}
