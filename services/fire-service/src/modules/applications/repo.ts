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

export async function updateStatus(
  tx: ScopedTx,
  tenantId: string,
  id: string,
  status: string,
  fromStatuses: readonly string[],
  actorId: string,
) {
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
