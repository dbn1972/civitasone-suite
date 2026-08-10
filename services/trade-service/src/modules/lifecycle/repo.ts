import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { tradeRenewals, type TradeRenewalRow, type TradeRenewalInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<TradeRenewalRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(tradeRenewals)
      .where(and(eq(tradeRenewals.id, id), eq(tradeRenewals.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByLicence(licenceId: string, tenantId: string): Promise<TradeRenewalRow[]> {
  return scopedRead((tx) =>
    tx.select().from(tradeRenewals)
      .where(and(eq(tradeRenewals.tenantId, tenantId), eq(tradeRenewals.licenceId, licenceId)))
      .orderBy(desc(tradeRenewals.createdAt)),
  );
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; renewalType?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: TradeRenewalRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(tradeRenewals.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(tradeRenewals.status, opts.status));
  if (opts.renewalType) conditions.push(eq(tradeRenewals.renewalType, opts.renewalType));
  const rows = await scopedRead((tx) =>
    tx.select().from(tradeRenewals).where(and(...conditions)).orderBy(desc(tradeRenewals.createdAt)).limit(pageSize).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(tradeRenewals).where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRenewal(tx: ScopedTx, row: TradeRenewalInsert): Promise<void> {
  await tx.insert(tradeRenewals).values(row);
}

export async function updateDecision(
  tx: ScopedTx, id: string, tenantId: string, status: string,
  decidedBy: string, reason: string | null, newValidUntil: Date | null,
): Promise<boolean> {
  const result = await tx.update(tradeRenewals)
    .set({ status, decision: status, decidedBy, decidedAt: new Date(), decisionReason: reason, newValidUntil, updatedBy: decidedBy, updatedAt: new Date(), version: sql`${tradeRenewals.version} + 1` })
    .where(and(eq(tradeRenewals.id, id), eq(tradeRenewals.tenantId, tenantId)))
    .returning({ id: tradeRenewals.id });
  return result.length > 0;
}
