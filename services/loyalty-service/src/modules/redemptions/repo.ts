/**
 * redemptions/repo.ts — Database operations for point redemptions.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { redemptions, type RedemptionRow, type RedemptionInsert } from "./schema.js";

export function toView(r: RedemptionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    memberId: r.memberId,
    enrolmentId: r.enrolmentId,
    points: r.points.toString(),
    rewardType: r.rewardType,
    status: r.status,
    redeemedAt: r.redeemedAt.toISOString(),
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
  };
}

export type RedemptionView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<RedemptionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(redemptions).where(and(eq(redemptions.id, id), eq(redemptions.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByEnrolment(
  tenantId: string,
  enrolmentId: string,
  limit: number,
  offset: number,
): Promise<{ rows: RedemptionRow[]; total: number }> {
  const where: SQL = and(eq(redemptions.tenantId, tenantId), eq(redemptions.enrolmentId, enrolmentId))!;

  const rows = await scopedRead((tx) =>
    tx.select().from(redemptions).where(where).orderBy(desc(redemptions.redeemedAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(redemptions).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: RedemptionRow[]; total: number }> {
  const where: SQL = eq(redemptions.tenantId, tenantId);

  const rows = await scopedRead((tx) =>
    tx.select().from(redemptions).where(where).orderBy(desc(redemptions.redeemedAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(redemptions).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: RedemptionInsert): Promise<void> {
  await tx.insert(redemptions).values(row);
}

export async function voidRedemption(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  reason: string,
  actorId: string,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(redemptions)
    .set({
      status: "voided",
      voidedAt: new Date(),
      voidReason: reason,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${redemptions.version} + 1`,
    })
    .where(
      and(eq(redemptions.id, id), eq(redemptions.tenantId, tenantId), eq(redemptions.version, currentVersion)),
    )
    .returning({ id: redemptions.id });
  return result.length > 0;
}
