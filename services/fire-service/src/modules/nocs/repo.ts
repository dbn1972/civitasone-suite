import { eq, and, sql, desc } from "drizzle-orm";
import { fireNocsTable } from "./schema.js";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import type { FireNocInsert } from "./schema.js";

export async function findById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(fireNocsTable)
      .where(and(eq(fireNocsTable.tenantId, tenantId), eq(fireNocsTable.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function findByVerificationCode(verificationCode: string) {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(fireNocsTable)
      .where(eq(fireNocsTable.verificationCode, verificationCode))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function list(
  tenantId: string,
  opts: { status?: string; limit?: number; offset?: number } = {},
) {
  return scopedRead(async (tx) => {
    const conditions = [eq(fireNocsTable.tenantId, tenantId)];
    if (opts.status) conditions.push(eq(fireNocsTable.status, opts.status));

    const where = and(...conditions);
    const rows = await tx
      .select()
      .from(fireNocsTable)
      .where(where)
      .orderBy(desc(fireNocsTable.createdAt))
      .limit(opts.limit ?? 25)
      .offset(opts.offset ?? 0);

    const countResult = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(fireNocsTable)
      .where(where);

    return { rows, total: countResult[0]?.total ?? 0 };
  });
}

export async function insert(tx: ScopedTx, data: FireNocInsert) {
  const rows = await tx.insert(fireNocsTable).values(data).returning();
  return rows[0]!;
}

export async function updateStatus(
  tx: ScopedTx,
  tenantId: string,
  id: string,
  status: string,
  actorId: string,
) {
  const rows = await tx
    .update(fireNocsTable)
    .set({
      status,
      version: sql`${fireNocsTable.version} + 1`,
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(and(eq(fireNocsTable.tenantId, tenantId), eq(fireNocsTable.id, id)))
    .returning();
  return rows[0] ?? null;
}
