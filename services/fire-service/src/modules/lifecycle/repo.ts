import { eq, and, sql, desc } from "drizzle-orm";
import { fireRenewalsTable } from "./schema.js";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import type { FireRenewalInsert } from "./schema.js";

export async function findById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(fireRenewalsTable)
      .where(and(eq(fireRenewalsTable.tenantId, tenantId), eq(fireRenewalsTable.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function list(
  tenantId: string,
  opts: { status?: string; limit?: number; offset?: number } = {},
) {
  return scopedRead(async (tx) => {
    const conditions = [eq(fireRenewalsTable.tenantId, tenantId)];
    if (opts.status) conditions.push(eq(fireRenewalsTable.status, opts.status));

    const where = and(...conditions);
    const rows = await tx
      .select()
      .from(fireRenewalsTable)
      .where(where)
      .orderBy(desc(fireRenewalsTable.createdAt))
      .limit(opts.limit ?? 25)
      .offset(opts.offset ?? 0);

    const countResult = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(fireRenewalsTable)
      .where(where);

    return { rows, total: countResult[0]?.total ?? 0 };
  });
}

export async function insert(tx: ScopedTx, data: FireRenewalInsert) {
  const rows = await tx.insert(fireRenewalsTable).values(data).returning();
  return rows[0]!;
}

export async function updateDecision(
  tx: ScopedTx,
  tenantId: string,
  id: string,
  decision: string,
  status: string,
  newValidUntil: string | null,
  actorId: string,
) {
  const rows = await tx
    .update(fireRenewalsTable)
    .set({
      decision,
      status,
      newValidUntil,
      decidedBy: actorId,
      decidedAt: new Date(),
      version: sql`${fireRenewalsTable.version} + 1`,
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(and(eq(fireRenewalsTable.tenantId, tenantId), eq(fireRenewalsTable.id, id)))
    .returning();
  return rows[0] ?? null;
}
