import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollLopLedger } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function upsertLopDays(
  tx: Writer,
  tenantId: string,
  employeeId: string,
  month: string,
  source: string,
  addDays: number,
): Promise<void> {
  const existing = await (tx as typeof db).select().from(payrollLopLedger)
    .where(and(
      eq(payrollLopLedger.tenantId, tenantId),
      eq(payrollLopLedger.employeeId, employeeId),
      eq(payrollLopLedger.month, month),
      eq(payrollLopLedger.source, source),
    )).limit(1);
  if (existing[0]) {
    await tx.update(payrollLopLedger)
      .set({ lopDays: existing[0].lopDays + addDays, updatedAt: new Date() })
      .where(eq(payrollLopLedger.id, existing[0].id));
  } else {
    await tx.insert(payrollLopLedger).values({
      tenantId, employeeId, month, source, lopDays: addDays,
    });
  }
}

export async function sumLopDays(tenantId: string, employeeId: string, month: string): Promise<number> {
  const [row] = await db.select({ total: sql<number>`coalesce(sum(${payrollLopLedger.lopDays}), 0)::int` })
    .from(payrollLopLedger)
    .where(and(
      eq(payrollLopLedger.tenantId, tenantId),
      eq(payrollLopLedger.employeeId, employeeId),
      eq(payrollLopLedger.month, month),
    ));
  return row?.total ?? 0;
}
