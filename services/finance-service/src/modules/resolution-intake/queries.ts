/**
 * Resolution Sanction Intake — read queries (RLS-scoped).
 *
 * Reads run inside db.transaction() so the tenant GUC (SET LOCAL app.tenant_id)
 * is applied and the `budget.current_tenant_id()` RLS policy is enforced, on top
 * of the explicit tenant filter (belt-and-suspenders).
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeResolutionSanctionIntake as t } from "./schema.js";

export interface IntakeRecord {
  id: string;
  tenantId: string;
  source: string;
  decisionId: string;
  meetingId: string | null;
  committeeId: string | null;
  title: string | null;
  text: string;
  amountMinor: string;
  currency: string;
  authority: string | null;
  effectiveDate: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(r: typeof t.$inferSelect): IntakeRecord {
  return { ...r, amountMinor: String(r.amountMinor) } as unknown as IntakeRecord;
}

export async function listIntake(
  tenantId: string,
  options: { status?: "pending_review" | "accepted" | "rejected"; page: number; pageSize: number },
): Promise<{ data: IntakeRecord[]; total: number }> {
  const { status, page, pageSize } = options;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(t.tenantId, tenantId)];
  if (status) conditions.push(eq(t.status, status));
  const whereClause = and(...conditions);

  return db.transaction(async (tx) => {
    const [rows, countResult] = await Promise.all([
      tx.select().from(t).where(whereClause).orderBy(desc(t.createdAt)).limit(pageSize).offset(offset),
      tx.select({ count: sql<number>`count(*)::int` }).from(t).where(whereClause),
    ]);
    return { data: rows.map(toRecord), total: countResult[0]?.count ?? 0 };
  });
}

export async function getIntakeById(tenantId: string, id: string): Promise<IntakeRecord | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(t).where(and(eq(t.id, id), eq(t.tenantId, tenantId))).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  });
}
