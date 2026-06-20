import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  payrollStructures, payrollRuns, payrollSlips,
  type PayrollRunRow, type PayrollRunInsert, type PayrollSlipRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findRunById(id: string, tenantId: string): Promise<PayrollRunRow | null> {
  const rows = await db.select().from(payrollRuns)
    .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findSlipById(id: string, tenantId: string): Promise<PayrollSlipRow | null> {
  const rows = await db.select().from(payrollSlips)
    .where(and(eq(payrollSlips.id, id), eq(payrollSlips.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRunsByTenant(tenantId: string, limit = 50): Promise<PayrollRunRow[]> {
  return db.select().from(payrollRuns)
    .where(eq(payrollRuns.tenantId, tenantId))
    .limit(limit);
}

export async function insertStructure(tx: Writer, row: typeof payrollStructures.$inferInsert): Promise<void> {
  await tx.insert(payrollStructures).values(row);
}

export async function insertRun(tx: Writer, row: PayrollRunInsert): Promise<void> {
  await tx.insert(payrollRuns).values(row);
}

export async function updateRun(tx: Writer, id: string, patch: Partial<PayrollRunInsert>): Promise<void> {
  await tx.update(payrollRuns).set({ ...patch, updatedAt: new Date() }).where(eq(payrollRuns.id, id));
}

export async function insertSlip(tx: Writer, row: typeof payrollSlips.$inferInsert): Promise<void> {
  await tx.insert(payrollSlips).values(row);
}

export async function listSlipsByTenant(tenantId: string, limit = 100): Promise<PayrollSlipRow[]> {
  return db.select().from(payrollSlips)
    .where(eq(payrollSlips.tenantId, tenantId))
    .limit(limit);
}

export async function findRunByIdTx(tx: Writer, id: string): Promise<PayrollRunRow | null> {
  const rows = await (tx as typeof db).select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
  return rows[0] ?? null;
}
