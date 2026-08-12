import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { advPermits, advRenewals, type AdvPermitRow, type AdvPermitInsert, type AdvRenewalInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<AdvPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(advPermits)
      .where(and(eq(advPermits.id, id), eq(advPermits.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByVerificationCode(code: string): Promise<AdvPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(advPermits)
      .where(eq(advPermits.verificationCode, code))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: AdvPermitRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(advPermits.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(advPermits.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(advPermits)
      .where(and(...conditions))
      .orderBy(desc(advPermits.createdAt))
      .limit(pageSize)
      .offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(advPermits)
      .where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertPermit(tx: ScopedTx, row: AdvPermitInsert): Promise<void> {
  await tx.insert(advPermits).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  extra?: Partial<{ suspensionReason: string; cancellationReason: string; suspendedAt: Date; cancelledAt: Date }>,
): Promise<boolean> {
  const result = await tx.update(advPermits)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...extra,
      version: sql`${advPermits.version} + 1`,
    })
    .where(and(eq(advPermits.id, id), eq(advPermits.tenantId, tenantId)))
    .returning({ id: advPermits.id });
  return result.length > 0;
}

export async function insertRenewal(tx: ScopedTx, row: AdvRenewalInsert): Promise<void> {
  await tx.insert(advRenewals).values(row);
}
