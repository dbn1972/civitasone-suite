import { eq, ne, and, sql, inArray, count, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { listRunSuspensions, type RunSuspensionSummary } from "./subsistence-repo.js";
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

// fix/high-data-issues: added the `month` exact-filter param and, just as
// important on its own, an explicit ORDER BY -- this select previously had
// none, so `limit` returned whatever `limit` rows Postgres felt like handing
// back (implementation-defined, not guaranteed to be the most recent), which
// made every caller's "most recent N runs" assumption unsound. Ordering by
// month DESC makes `limit` mean what callers already assumed it meant, and
// lets a caller that wants exactly one period (e.g. run detail's MoM
// comparison) filter to it server-side instead of fetching a batch to scan.
export async function listRunsByTenant(tenantId: string, limit = 50, month?: string): Promise<PayrollRunRow[]> {
  return scopedRead((tx) => tx.select().from(payrollRuns)
    .where(month
      ? and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.month, month))
      : eq(payrollRuns.tenantId, tenantId))
    .orderBy(desc(payrollRuns.month))
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

export type SlipWithRun = PayrollSlipRow & { month: string; runDeptId: string | null };

/**
 * `opts.employeeId` (GAP-PAYROLL-SALARY-SLIPS-04, GET /slips/mine) narrows to ONE
 * employee, newest first, with `offset` paging. The caller must take that id
 * from the verified token's HRMS identity, never from client input.
 */
export async function listSlipsByTenant(
  tenantId: string,
  limit = 100,
  opts: { employeeId?: string; offset?: number; statuses?: readonly string[] } = {},
): Promise<SlipWithRun[]> {
  const rows = await scopedRead((tx) =>
    tx.select({
      id: payrollSlips.id,
      tenantId: payrollSlips.tenantId,
      runId: payrollSlips.runId,
      employeeId: payrollSlips.employeeId,
      employeeNo: payrollSlips.employeeNo,
      grossMinor: payrollSlips.grossMinor,
      totalDeductionsMinor: payrollSlips.totalDeductionsMinor,
      netPayMinor: payrollSlips.netPayMinor,
      status: payrollSlips.status,
      createdAt: payrollSlips.createdAt,
      updatedAt: payrollSlips.updatedAt,
      basicMinor: payrollSlips.basicMinor,
      currency: payrollSlips.currency,
      components: payrollSlips.components,
      pfEmployeeMinor: payrollSlips.pfEmployeeMinor,
      pfEmployerMinor: payrollSlips.pfEmployerMinor,
      gpfMinor: payrollSlips.gpfMinor,
      npsEmployeeMinor: payrollSlips.npsEmployeeMinor,
      npsEmployerMinor: payrollSlips.npsEmployerMinor,
      esiMinor: payrollSlips.esiMinor,
      tdsMinor: payrollSlips.tdsMinor,
      createdBy: payrollSlips.createdBy,
      updatedBy: payrollSlips.updatedBy,
      version: payrollSlips.version,
      payProfile: payrollSlips.payProfile,
      profileSnapshot: payrollSlips.profileSnapshot,
      pfWageMinor: payrollSlips.pfWageMinor,
      month: payrollRuns.month,
      runDeptId: payrollRuns.departmentId,
    })
    .from(payrollSlips)
    .leftJoin(payrollRuns, eq(payrollSlips.runId, payrollRuns.id))
    .where(opts.employeeId
      ? and(
          eq(payrollSlips.tenantId, tenantId),
          eq(payrollSlips.employeeId, opts.employeeId),
          ...(opts.statuses ? [inArray(payrollSlips.status, [...opts.statuses])] : []),
        )
      : eq(payrollSlips.tenantId, tenantId))
    .orderBy(...(opts.employeeId ? [desc(payrollRuns.month), desc(payrollSlips.createdAt)] : []))
    .limit(limit)
    .offset(opts.offset ?? 0)
  );
  return rows.map(r => ({ ...r, month: r.month ?? "", runDeptId: r.runDeptId ?? null }));
}

export async function findRunByIdTx(tx: Writer, id: string): Promise<PayrollRunRow | null> {
  const rows = await (tx as typeof db).select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listComponentsByStructure(structureId: string, tenantId: string) {
  return scopedRead((tx) => tx.select().from(payrollComponents)
    .where(and(eq(payrollComponents.structureId, structureId), eq(payrollComponents.tenantId, tenantId))));
}

export async function listComponentsByTenant(tenantId: string, limit: number) {
  return scopedRead((tx) => tx.select().from(payrollComponents)
    .where(eq(payrollComponents.tenantId, tenantId)).limit(limit));
}

/** FR 53: the run's pay-suspended employees (payroll.payroll_run_suspensions, migration 0057). */
export async function listRunSuspensionsByRun(runId: string, tenantId: string): Promise<RunSuspensionSummary[]> {
  return scopedRead((tx) => listRunSuspensions(tx as unknown as typeof db, tenantId, runId));
}

export async function listSlipsByRun(runId: string, tenantId: string): Promise<PayrollSlipRow[]> {
  return scopedRead((tx) => tx.select().from(payrollSlips)
    .where(and(eq(payrollSlips.runId, runId), eq(payrollSlips.tenantId, tenantId))));
}

/**
 * PERF-005 batch loader, extended for the runs-list totals-vs-headcount
 * finding: employee-count AND live gross/net totals per run, computed via
 * one SQL COUNT+SUM/GROUP BY across ALL given run ids in one query, instead
 * of fetching every slip row for every run (listSlipsByRun in a per-run
 * loop) just to read `.length`/sum it -- same "one query regardless of N"
 * shape as the original PERF-005 fix, just with two more aggregates riding
 * the same GROUP BY. Runs with zero slips are simply absent from the
 * returned Map -- callers should default to
 * {employeeCount: 0, grossMinor: 0n, netMinor: 0n} on a miss, which is
 * exactly the state a zero-payslip run must display (Rs.0, never a
 * possibly-stale payroll_runs.total_gross_minor/total_net_minor column
 * value -- see the matching listRuns fix in queries.ts).
 */
export async function aggregateSlipsByRunIds(
  runIds: string[],
  tenantId: string,
): Promise<Map<string, { employeeCount: number; grossMinor: bigint; netMinor: bigint }>> {
  if (runIds.length === 0) return new Map();
  const rows = await scopedRead((tx) => tx
    .select({
      runId: payrollSlips.runId,
      employeeCount: count(),
      grossMinor: sql<string>`coalesce(sum(${payrollSlips.grossMinor}), 0)::bigint`,
      netMinor: sql<string>`coalesce(sum(${payrollSlips.netPayMinor}), 0)::bigint`,
    })
    .from(payrollSlips)
    .where(and(inArray(payrollSlips.runId, runIds), eq(payrollSlips.tenantId, tenantId)))
    .groupBy(payrollSlips.runId));
  return new Map(rows.map((r) => [r.runId, {
    employeeCount: Number(r.employeeCount),
    grossMinor: BigInt(r.grossMinor),
    netMinor: BigInt(r.netMinor),
  }]));
}

/** M1: transaction-scoped slip read (for computing authoritative run totals). */
export async function listSlipsByRunTx(tx: Writer, runId: string, tenantId: string): Promise<PayrollSlipRow[]> {
  return (tx as typeof db).select().from(payrollSlips)
    .where(and(eq(payrollSlips.runId, runId), eq(payrollSlips.tenantId, tenantId)));
}

/**
 * Marks a disbursed run's slips paid. "exception" slips (negative net) are
 * excluded from the disbursed amount (consumer.ts runDisburse filters them out
 * of slipNet), so they were never paid and must keep their status -- marking
 * them "paid" recorded money that never moved and made them printable.
 */
export async function markSlipsPaidForRun(tx: Writer, runId: string, actorId: string): Promise<void> {
  await tx.update(payrollSlips)
    .set({ status: "paid", updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(payrollSlips.runId, runId), ne(payrollSlips.status, "exception")));
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

// FORCE-RLS fix: this used to run as a bare db.execute() outside any
// transaction. payroll.payroll_arrears is FORCE RLS, so under the
// NOBYPASSRLS payroll_svc role the INSERT's WITH CHECK has no app.tenant_id
// GUC to satisfy -- confirmed directly against Postgres, this throws "new
// row violates row-level security policy" on every call, not a silent
// no-op. Same fix as this file's sibling *read* functions just above
// (listArrears etc.) already use: route the write through scopedRead so its
// db.transaction wrapper sets the GUC first.
export async function insertArrear(p: ArrearInsert) {
  const diff = p.newAmountMinor - p.oldAmountMinor;
  const rows = await scopedRead((tx) => tx.execute(sql`
    INSERT INTO payroll.payroll_arrears(tenant_id,employee_id,component_code,from_period,to_period,old_amount_minor,new_amount_minor,difference_minor,reason,created_by)
    VALUES(${p.tenantId}::uuid,${p.employeeId}::uuid,${p.componentCode},${p.fromPeriod},${p.toPeriod},${p.oldAmountMinor},${p.newAmountMinor},${diff},${p.reason},${p.actorId}::uuid)
    RETURNING id,difference_minor,status`));
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

// FORCE-RLS fix: same bare-db.execute()-outside-any-transaction anti-pattern
// as insertArrear above (payroll.payroll_bonus is FORCE RLS too); same fix.
export async function insertBonus(p: BonusInsert) {
  const rows = await scopedRead((tx) => tx.execute(sql`
    INSERT INTO payroll.payroll_bonus(tenant_id,employee_id,fy,basic_minor,bonus_pct,bonus_amount_minor)
    VALUES(${p.tenantId}::uuid,${p.employeeId}::uuid,${p.fy},${p.basicMinor},${p.bonusPct},${p.bonusAmountMinor})
    RETURNING id,bonus_amount_minor,status`));
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

// FORCE-RLS fix: same bare-db.execute()-outside-any-transaction anti-pattern
// as insertArrear above (payroll.payroll_reimbursements is FORCE RLS too); same fix.
export async function insertReimbursement(p: ReimbursementInsert) {
  const rows = await scopedRead((tx) => tx.execute(sql`
    INSERT INTO payroll.payroll_reimbursements(tenant_id,employee_id,category,amount_minor,bill_date,bill_ref,period,created_by)
    VALUES(${p.tenantId}::uuid,${p.employeeId}::uuid,${p.category},${p.amountMinor},${p.billDate}::date,${p.billRef},${p.period},${p.actorId}::uuid)
    RETURNING id,category,amount_minor,status`));
  return (rows as unknown[])[0];
}

// ─── Salary Revisions ─────────────────────────────────────────────────────────

export async function listSalaryRevisions(tenantId: string, employeeId: string | null) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_salary_revisions WHERE tenant_id=${tenantId}::uuid AND (${employeeId}::uuid IS NULL OR employee_id=${employeeId}::uuid) ORDER BY effective_date DESC LIMIT 100`));
}

// ─── Payroll Register ─────────────────────────────────────────────────────────

/**
 * GAP-PAYROLL-REGISTER-WRITER: rows are written when a run is computed, so a
 * run awaiting approval has rows too. With an explicit runId every status is
 * returned (the pre-approval variance check); a period/all view shows
 * finalised runs only -- status IN ('approved','disbursed'), the same set the
 * YTD-TDS true-up (consumer.ts resolveTdsYtdMinorsTx) and the costing report
 * use. payroll_runs_status_check_extended (0027/0047) also permits 'paid',
 * 'computed' and 'cancelled', but no code ever writes them.
 */
export async function listRegister(tenantId: string, period: string | null, runId: string | null) {
  if (runId) {
    return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_register WHERE tenant_id=${tenantId}::uuid AND (${period}::text IS NULL OR period=${period}) AND run_id=${runId}::uuid ORDER BY department_name`));
  }
  return scopedRead((tx) => tx.execute(sql`
    SELECT g.* FROM payroll.payroll_register g
      JOIN payroll.payroll_runs r ON r.id = g.run_id AND r.tenant_id = g.tenant_id
     WHERE g.tenant_id=${tenantId}::uuid AND (${period}::text IS NULL OR g.period=${period})
       AND r.status IN ('approved', 'disbursed')
     ORDER BY g.department_name`));
}

// ─── CTC Config ───────────────────────────────────────────────────────────────

export async function listCtcConfig(tenantId: string) {
  return scopedRead((tx) => tx.execute(sql`SELECT * FROM payroll.payroll_ctc_config WHERE tenant_id=${tenantId}::uuid AND is_active=true ORDER BY component_code`));
}

// ─── Payroll Comparison ───────────────────────────────────────────────────────

/**
 * GAP-PAYROLL-COMPARISON-02: `hasData` is false when the register has no
 * rows for the period. The sums COALESCE to 0, so without it a missing
 * period was indistinguishable from a real ₹0 payroll.
 */
export type PeriodSummary = { gross: bigint; net: bigint; headcount: number; hasData: boolean };

export async function getRegisterSummary(tenantId: string, period: string): Promise<PeriodSummary> {
  // GAP-PAYROLL-REGISTER-WRITER: finalised runs only (see listRegister).
  // gross/net add up across every finalised run of the month (regular +
  // supplementary + arrears is the month's real cost), but headcount is the
  // DISTINCT employees paid in those runs -- summing employee_count would
  // count someone in both a regular and a supplementary run twice.
  const rows = await scopedRead((tx) => tx.execute(sql`
    WITH runs AS (
      SELECT DISTINCT g.run_id FROM payroll.payroll_register g
        JOIN payroll.payroll_runs r ON r.id = g.run_id AND r.tenant_id = g.tenant_id
       WHERE g.tenant_id=${tenantId}::uuid AND g.period=${period} AND r.status IN ('approved', 'disbursed')
    )
    SELECT COALESCE(SUM(g.total_gross_minor),0)::bigint AS gross,
           COALESCE(SUM(g.total_net_minor),0)::bigint AS net,
           (SELECT COUNT(DISTINCT s.employee_id) FROM payroll.payroll_slips s
             WHERE s.tenant_id=${tenantId}::uuid AND s.run_id IN (SELECT run_id FROM runs))::int AS headcount,
           (COUNT(*) > 0) AS "hasData"
      FROM payroll.payroll_register g
     WHERE g.tenant_id=${tenantId}::uuid AND g.run_id IN (SELECT run_id FROM runs)`));
  return (rows as unknown[])[0] as PeriodSummary;
}
