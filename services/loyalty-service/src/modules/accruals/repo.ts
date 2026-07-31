/**
 * accruals/repo.ts — Database operations for points accruals.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { accruals, type AccrualRow, type AccrualInsert } from "./schema.js";

export function toView(r: AccrualRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    enrolmentId: r.enrolmentId,
    points: r.points.toString(),
    source: r.source,
    sourceRef: r.sourceRef,
    txType: r.txType,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    accrualDate: r.accrualDate.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

export type AccrualView = ReturnType<typeof toView>;

export async function listByEnrolment(
  tenantId: string,
  enrolmentId: string,
  limit: number,
  offset: number,
): Promise<{ rows: AccrualRow[]; total: number }> {
  const where: SQL = and(eq(accruals.tenantId, tenantId), eq(accruals.enrolmentId, enrolmentId))!;

  const rows = await scopedRead((tx) =>
    tx.select().from(accruals).where(where).orderBy(desc(accruals.accrualDate)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(accruals).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function getBalanceSummary(
  tenantId: string,
  enrolmentId: string,
): Promise<{ totalAccrued: bigint; activePoints: bigint }> {
  const result = await scopedRead((tx) =>
    tx
      .select({
        totalAccrued: sql<string>`COALESCE(SUM(${accruals.points}), 0)::text`,
        activePoints: sql<string>`COALESCE(SUM(CASE WHEN ${accruals.expiresAt} IS NULL OR ${accruals.expiresAt} > now() THEN ${accruals.points} ELSE 0 END), 0)::text`,
      })
      .from(accruals)
      .where(and(eq(accruals.tenantId, tenantId), eq(accruals.enrolmentId, enrolmentId))),
  );

  return {
    totalAccrued: BigInt(result[0]?.totalAccrued ?? "0"),
    activePoints: BigInt(result[0]?.activePoints ?? "0"),
  };
}

export async function insert(tx: ScopedTx, row: AccrualInsert): Promise<void> {
  await tx.insert(accruals).values(row);
}
