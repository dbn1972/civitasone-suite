/**
 * Resolution Indent Intake — read queries (RLS-scoped).
 *
 * Reads run inside db.transaction() so the tenant GUC (SET LOCAL app.tenant_id)
 * is applied and the `indent.current_tenant_id()` RLS policy is enforced, on top
 * of the explicit tenant filter (belt-and-suspenders). indent.current_tenant_id()
 * is strict (errors when the GUC is unset), so the transaction wrap is required.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementResolutionIndentIntake as t } from "./schema.js";

export interface IntakeRecord {
  id: string;
  tenantId: string;
  source: string;
  decisionId: string;
  meetingId: string | null;
  committeeId: string | null;
  title: string | null;
  text: string;
  authority: string | null;
  effectiveDate: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
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
    return { data: rows as unknown as IntakeRecord[], total: countResult[0]?.count ?? 0 };
  });
}

export async function getIntakeById(tenantId: string, id: string): Promise<IntakeRecord | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(t).where(and(eq(t.id, id), eq(t.tenantId, tenantId))).limit(1);
    return (rows[0] as unknown as IntakeRecord) ?? null;
  });
}
