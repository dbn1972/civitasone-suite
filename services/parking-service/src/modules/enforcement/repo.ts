import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { parkingViolations, type ViolationRow, type ViolationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<ViolationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(parkingViolations)
      .where(and(eq(parkingViolations.id, id), eq(parkingViolations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: ViolationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(parkingViolations.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(parkingViolations.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(parkingViolations)
      .where(and(...conditions))
      .orderBy(desc(parkingViolations.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(parkingViolations)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertViolation(tx: ScopedTx, row: ViolationInsert): Promise<void> {
  await tx.insert(parkingViolations).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  fromStatuses: readonly string[],
  updatedBy: string,
): Promise<ViolationRow | null> {
  const result = await tx.update(parkingViolations)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${parkingViolations.version} + 1`,
    })
    .where(and(
      eq(parkingViolations.id, id),
      eq(parkingViolations.tenantId, tenantId),
      inArray(parkingViolations.status, fromStatuses as string[]),
    ))
    .returning();
  return result[0] ?? null;
}
