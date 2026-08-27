import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { advViolations, type AdvViolationRow, type AdvViolationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<AdvViolationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(advViolations)
      .where(and(eq(advViolations.id, id), eq(advViolations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: AdvViolationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(advViolations.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(advViolations.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(advViolations)
      .where(and(...conditions))
      .orderBy(desc(advViolations.createdAt))
      .limit(pageSize)
      .offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(advViolations)
      .where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertViolation(tx: ScopedTx, row: AdvViolationInsert): Promise<void> {
  await tx.insert(advViolations).values(row);
}

export async function updateViolation(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  updates: Partial<AdvViolationInsert> & { status: string },
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(advViolations)
    .set({ ...updates, updatedBy, updatedAt: new Date(), version: sql`${advViolations.version} + 1` })
    .where(and(eq(advViolations.id, id), eq(advViolations.tenantId, tenantId)))
    .returning({ id: advViolations.id });
  return result.length > 0;
}
