import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { contractRenewals, type RenewalRow, type RenewalInsert } from "./schema.js";

async function tenantRead<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

export async function insertRenewal(renewal: RenewalInsert): Promise<RenewalRow> {
  return tenantRead(renewal.tenantId, async (tx) => {
    const [row] = await tx.insert(contractRenewals).values(renewal).returning();
    return row!;
  });
}

export async function getRenewalById(id: string, tenantId: string): Promise<RenewalRow | undefined> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(contractRenewals)
      .where(and(eq(contractRenewals.id, id), eq(contractRenewals.tenantId, tenantId)))
      .limit(1);
    return row;
  });
}

export async function listRenewals(
  tenantId: string,
  opts: { contractId?: string; status?: string; limit: number; offset: number },
): Promise<{ data: RenewalRow[]; total: number }> {
  return tenantRead(tenantId, async (tx) => {
    const conditions = [eq(contractRenewals.tenantId, tenantId)];
    if (opts.contractId) conditions.push(eq(contractRenewals.contractId, opts.contractId));
    if (opts.status) conditions.push(eq(contractRenewals.status, opts.status));

    const where = and(...conditions);

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contractRenewals)
      .where(where);

    const data = await tx
      .select()
      .from(contractRenewals)
      .where(where)
      .orderBy(desc(contractRenewals.expiryDate))
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: countResult?.count ?? 0 };
  });
}

export async function updateRenewal(
  id: string,
  tenantId: string,
  currentVersion: number,
  updates: Partial<Pick<RenewalRow, "advanceNoticeDays" | "status" | "renewedAt" | "renewedBy" | "updatedBy">>,
): Promise<RenewalRow | null> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .update(contractRenewals)
      .set({
        ...updates,
        version: currentVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contractRenewals.id, id),
          eq(contractRenewals.tenantId, tenantId),
          eq(contractRenewals.version, currentVersion),
        ),
      )
      .returning();
    return row ?? null;
  });
}
