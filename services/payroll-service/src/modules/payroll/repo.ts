import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  payrollStructures, payrollComponents, payrollRuns, payrollSlips,
  type PayrollRunRow, type PayrollRunInsert, type PayrollSlipRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findRunById(id: string, tenantId: string): Promise<PayrollRunRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(payrollRuns)
    .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function findSlipById(id: string, tenantId: string): Promise<PayrollSlipRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(payrollSlips)
    .where(and(eq(payrollSlips.id, id), eq(payrollSlips.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function listRunsByTenant(tenantId: string, limit = 50): Promise<PayrollRunRow[]> {
  return scopedRead((tx) => tx.select().from(payrollRuns)
    .where(eq(payrollRuns.tenantId, tenantId))
    .limit(limit));
}

export async function listStructuresByTenant(tenantId: string, limit = 50) {
  return scopedRead((tx) => tx.select().from(payrollStructures)
    .where(eq(payrollStructures.tenantId, tenantId))
    .limit(limit));
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
  return scopedRead((tx) => tx.select().from(payrollSlips)
    .where(eq(payrollSlips.tenantId, tenantId))
    .limit(limit));
}

export async function findRunByIdTx(tx: Writer, id: string): Promise<PayrollRunRow | null> {
  const rows = await (tx as typeof db).select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listComponentsByStructure(structureId: string, tenantId: string) {
  return scopedRead((tx) => tx.select().from(payrollComponents)
    .where(and(eq(payrollComponents.structureId, structureId), eq(payrollComponents.tenantId, tenantId))));
}

export async function listSlipsByRun(runId: string, tenantId: string): Promise<PayrollSlipRow[]> {
  return scopedRead((tx) => tx.select().from(payrollSlips)
    .where(and(eq(payrollSlips.runId, runId), eq(payrollSlips.tenantId, tenantId))));
}

/** M1: transaction-scoped slip read (for computing authoritative run totals). */
export async function listSlipsByRunTx(tx: Writer, runId: string, tenantId: string): Promise<PayrollSlipRow[]> {
  return (tx as typeof db).select().from(payrollSlips)
    .where(and(eq(payrollSlips.runId, runId), eq(payrollSlips.tenantId, tenantId)));
}

export async function markSlipsPaidForRun(tx: Writer, runId: string, actorId: string): Promise<void> {
  await tx.update(payrollSlips)
    .set({ status: "paid", updatedAt: new Date(), updatedBy: actorId })
    .where(eq(payrollSlips.runId, runId));
}

// ── world-class-routes repo functions ─────────────────────────────────────────
// Raw-SQL helpers for supplemental payroll tables not yet in the Drizzle schema.
// All functions accept tenantId as the first arg for RLS-style filtering.

// ─── Arrears ──────────────────────────────────────────────────────────────────

export async function listArrears(tenantId: string) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_arrears WHERE tenant_id=${tenantId}::uuid ORDER BY created_at DESC LIMIT 100`));
}

export type ArrearInsert = {
  tenantId: string; employeeId: string; componentCode: string; fromPeriod: string; toPeriod: string;
  oldAmountMinor: number; newAmountMinor: number; reason: string | null; actorId: string;
};

export async function insertArrear(p: ArrearInsert) {
  const diff = p.newAmountMinor - p.oldAmountMinor;
  const rows = await db.execute(sql`
    INSERT INTO payroll.payroll_arrears(tenant_id,employee_id,component_code,from_period,to_period,old_amount_minor,new_amount_minor,difference_minor,reason,created_by)
    VALUES(${p.tenantId}::uuid,${p.employeeId}::uuid,${p.componentCode},${p.fromPeriod},${p.toPeriod},${p.oldAmountMinor},${p.newAmountMinor},${diff},${p.reason},${p.actorId}::uuid)
    RETURNING id,difference_minor,status`);
  return (rows as unknown[])[0];
}

// ─── Bonus ────────────────────────────────────────────────────────────────────

export async function listBonus(tenantId: string, fy: string | null) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_bonus WHERE tenant_id=${tenantId}::uuid AND (${fy}::text IS NULL OR fy=${fy}) ORDER BY created_at DESC`));
}

export type BonusInsert = {
  tenantId: string; employeeId: string; fy: string;
  basicMinor: number; bonusPct: number; bonusAmountMinor: number;
};

export async function insertBonus(p: BonusInsert) {
  const rows = await db.execute(sql`
    INSERT INTO payroll.payroll_bonus(tenant_id,employee_id,fy,basic_minor,bonus_pct,bonus_amount_minor)
    VALUES(${p.tenantId}::uuid,${p.employeeId}::uuid,${p.fy},${p.basicMinor},${p.bonusPct},${p.bonusAmountMinor})
    RETURNING id,bonus_amount_minor,status`);
  return (rows as unknown[])[0];
}

// ─── Professional Tax ─────────────────────────────────────────────────────────

export async function listProfessionalTax(tenantId: string) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_professional_tax WHERE tenant_id=${tenantId}::uuid AND is_active=true ORDER BY state_code,slab_from_minor`));
}

// ─── Labour Welfare Fund ──────────────────────────────────────────────────────

export async function listLwf(tenantId: string) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_lwf WHERE tenant_id=${tenantId}::uuid ORDER BY state_code`));
}

// ─── Reimbursements ───────────────────────────────────────────────────────────

export async function listReimbursements(tenantId: string, employeeId: string | null, status: string | null) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_reimbursements WHERE tenant_id=${tenantId}::uuid AND (${employeeId}::uuid IS NULL OR employee_id=${employeeId}::uuid) AND (${status}::text IS NULL OR status=${status}) ORDER BY created_at DESC LIMIT 100`));
}

export type ReimbursementInsert = {
  tenantId: string; employeeId: string; category: string; amountMinor: number;
  billDate: string | null; billRef: string | null; period: string; actorId: string;
};

export async function insertReimbursement(p: ReimbursementInsert) {
  const rows = await db.execute(sql`
    INSERT INTO payroll.payroll_reimbursements(tenant_id,employee_id,category,amount_minor,bill_date,bill_ref,period,created_by)
    VALUES(${p.tenantId}::uuid,${p.employeeId}::uuid,${p.category},${p.amountMinor},${p.billDate}::date,${p.billRef},${p.period},${p.actorId}::uuid)
    RETURNING id,category,amount_minor,status`);
  return (rows as unknown[])[0];
}

// ─── Salary Revisions ─────────────────────────────────────────────────────────

export async function listSalaryRevisions(tenantId: string, employeeId: string | null) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_salary_revisions WHERE tenant_id=${tenantId}::uuid AND (${employeeId}::uuid IS NULL OR employee_id=${employeeId}::uuid) ORDER BY effective_date DESC LIMIT 100`));
}

// ─── Payroll Register ─────────────────────────────────────────────────────────

export async function listRegister(tenantId: string, period: string | null, runId: string | null) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_register WHERE tenant_id=${tenantId}::uuid AND (${period}::text IS NULL OR period=${period}) AND (${runId}::uuid IS NULL OR run_id=${runId}::uuid) ORDER BY department_name`));
}

// ─── CTC Config ───────────────────────────────────────────────────────────────

export async function listCtcConfig(tenantId: string) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_ctc_config WHERE tenant_id=${tenantId}::uuid AND is_active=true ORDER BY component_code`));
}

// ─── Payroll Comparison ───────────────────────────────────────────────────────

export type PeriodSummary = { gross: bigint; net: bigint; headcount: number };

export async function getRegisterSummary(tenantId: string, period: string): Promise<PeriodSummary> {
  const rows = await scopedRead((tx) => tx.execute(sql`SELECT COALESCE(SUM(total_gross_minor),0)::bigint as gross,COALESCE(SUM(total_net_minor),0)::bigint as net,COALESCE(SUM(employee_count),0)::int as headcount FROM payroll.payroll_register WHERE tenant_id=${tenantId}::uuid AND period=${period}`));
  return (rows as unknown[])[0] as PeriodSummary;
}
