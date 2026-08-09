import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { renewals, type RenewalRow, type RenewalInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RenewalRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(renewals)
      .where(and(eq(renewals.id, id), eq(renewals.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByPermit(
  permitId: string,
  tenantId: string,
): Promise<RenewalRow[]> {
  return scopedRead((tx) =>
    tx.select().from(renewals)
      .where(and(eq(renewals.tenantId, tenantId), eq(renewals.permitId, permitId)))
      .orderBy(desc(renewals.createdAt)),
  );
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; renewalType?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: RenewalRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(renewals.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(renewals.status, opts.status));
  if (opts.renewalType) conditions.push(eq(renewals.renewalType, opts.renewalType));

  const rows = await scopedRead((tx) =>
    tx.select().from(renewals)
      .where(and(...conditions))
      .orderBy(desc(renewals.createdAt))
      .limit(pageSize)
      .offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(renewals)
      .where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRenewal(tx: ScopedTx, row: RenewalInsert): Promise<void> {
  await tx.insert(renewals).values(row);
}

export async function updateDecision(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  decidedBy: string,
  reason: string | null,
  newValidUntil: Date | null,
): Promise<boolean> {
  const result = await tx.update(renewals)
    .set({
      status,
      decidedBy,
      decidedAt: new Date(),
      decisionReason: reason,
      newValidUntil,
      updatedBy: decidedBy,
      updatedAt: new Date(),
      version: sql`${renewals.version} + 1`,
    })
    .where(and(eq(renewals.id, id), eq(renewals.tenantId, tenantId)))
    .returning({ id: renewals.id });
  return result.length > 0;
}
