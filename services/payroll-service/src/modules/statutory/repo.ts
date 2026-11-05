import { eq, and, desc, sql, type AnyColumn } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollPf, payrollTds, payrollEsi, payrollGratuity, payrollGpf, payrollNps, payrollUpsPool, payrollEpfAdminTopups } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * T-STAT delta review D-B1 (defence in depth): ledger rows whose slip was
 * EXCLUDED on approval (a Rs 0-basic slip that is never paid) are never
 * counted. Approval already removes those rows (deleteLedgerRowsForSlipTx);
 * every ledger reader also filters them, so rows written before that fix --
 * or any future path -- cannot reach the GL accrual, a return or Form 16.
 */
export function notExcludedSlip(slipIdColumn: AnyColumn) {
  return sql`NOT EXISTS (SELECT 1 FROM payroll.payroll_slips xs WHERE xs.id = ${slipIdColumn} AND xs.status = ${"excluded"})`;
}

type LedgerKey = "pf" | "esi" | "nps" | "ups_pool" | "gpf" | "tds";
/**
 * Business columns of each ledger, as returned by the DELETE (fixed lists:
 * no PII, nothing beyond the employee id) -- enough to rebuild every removed
 * row from the audit trail: wage bases, shares, PF EPF / EPS split, TDS.
 */
const LEDGER_AUDIT_COLUMNS: Record<LedgerKey, { scheme: string; columns: string[] }> = {
  pf:  { scheme: "EPF", columns: ["basic_minor", "emp_contrib_pct", "er_contrib_pct", "emp_contrib_minor", "er_contrib_minor", "eps_contrib_minor", "epf_er_contrib_minor"] },
  esi: { scheme: "ESI", columns: ["gross_minor", "emp_contrib_minor", "er_contrib_minor"] },
  nps: { scheme: "NPS", columns: ["basic_minor", "pension_base_minor", "emp_contrib_pct", "er_contrib_pct", "emp_contrib_minor", "er_contrib_minor"] },
  // UAT b18: the Government 8.5% UPS pool share (its own row, migration 0162).
  ups_pool: { scheme: "UPS_POOL", columns: ["pension_base_minor", "contrib_pct", "contrib_minor"] },
  gpf: { scheme: "GPF", columns: ["basic_minor", "contrib_pct", "emp_contrib_minor"] },
  tds: { scheme: "TDS", columns: ["annual_basic_minor", "taxable_minor", "tds_minor"] },
};
const camel = (c: string) => c.replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase());

/** One removed ledger row as recorded on the audit trail (amounts as paise digit strings). */
export type RemovedLedgerRow = { table: string; scheme: string; slipId: string; employeeId: string; runId: string; period: string; currency: string } & Record<string, string | null>;

/**
 * Delta review D-B1: remove one slip statutory ledger rows (PF / ESI / NPS /
 * GPF / TDS) with DELETE ... RETURNING, so the caller can audit exactly what
 * was removed: per-ledger counts and every removed row business fields.
 * Bounded: a slip has at most one row per ledger.
 */
export async function deleteLedgerRowsForSlipTx(tx: Pick<typeof db, "execute">, slipId: string, tenantId: string): Promise<{ counts: Record<LedgerKey, number>; rows: RemovedLedgerRow[] }> {
  return deleteLedgerRowsWhere(tx, sql`slip_id = ${slipId}::uuid AND tenant_id = ${tenantId}::uuid`);
}

/**
 * UAT L2-N3 review (send back a computed run): every statutory ledger row of
 * a run, removed with DELETE ... RETURNING the same audited business columns
 * as deleteLedgerRowsForSlipTx.
 */
export async function deleteLedgerRowsForRunTx(tx: Pick<typeof db, "execute">, runId: string, tenantId: string): Promise<{ counts: Record<LedgerKey, number>; rows: RemovedLedgerRow[] }> {
  return deleteLedgerRowsWhere(tx, sql`run_id = ${runId}::uuid AND tenant_id = ${tenantId}::uuid`);
}

async function deleteLedgerRowsWhere(tx: Pick<typeof db, "execute">, where: ReturnType<typeof sql>): Promise<{ counts: Record<LedgerKey, number>; rows: RemovedLedgerRow[] }> {
  const counts: Record<LedgerKey, number> = { pf: 0, esi: 0, nps: 0, ups_pool: 0, gpf: 0, tds: 0 };
  const rows: RemovedLedgerRow[] = [];
  for (const k of Object.keys(counts) as LedgerKey[]) {
    const { scheme, columns } = LEDGER_AUDIT_COLUMNS[k];
    const returning = ["slip_id", "employee_id", "run_id", "period", "currency", ...columns].map((c) => `${c}::text AS ${c}`).join(", ");
    const removed = (await tx.execute(sql`DELETE FROM ${sql.raw(`statutory.payroll_${k}`)}
      WHERE ${where} RETURNING ${sql.raw(returning)}`)) as unknown as Array<Record<string, string | null>>;
    counts[k] = removed.length;
    for (const r of removed) {
      const row: Record<string, string | null> = { table: `payroll_${k}`, scheme };
      for (const [col, v] of Object.entries(r)) row[camel(col)] = v == null ? null : String(v).trim();
      rows.push(row as RemovedLedgerRow);
    }
  }
  return { counts, rows };
}

export async function insertPf(tx: Writer, row: typeof payrollPf.$inferInsert): Promise<void> {
  await tx.insert(payrollPf).values(row);
}

export async function insertEsi(tx: Writer, row: typeof payrollEsi.$inferInsert): Promise<void> {
  await tx.insert(payrollEsi).values(row);
}

export async function insertTds(tx: Writer, row: typeof payrollTds.$inferInsert): Promise<void> {
  await tx.insert(payrollTds).values(row);
}

export async function insertGratuity(tx: Writer, row: typeof payrollGratuity.$inferInsert): Promise<void> {
  await tx.insert(payrollGratuity).values(row);
}

export async function insertGpf(tx: Writer, row: typeof payrollGpf.$inferInsert): Promise<void> {
  await tx.insert(payrollGpf).values(row);
}

export async function insertNps(tx: Writer, row: typeof payrollNps.$inferInsert): Promise<void> {
  await tx.insert(payrollNps).values(row);
}

/** Delta review: EPF members of a run whose EPS eligibility was defaulted (eps_basis = default). */
export async function epsUnrecordedEmployeeIdsByRunTx(tx: Writer, runId: string, tenantId: string): Promise<string[]> {
  const rows = await tx.select({ employeeId: payrollPf.employeeId }).from(payrollPf)
    .where(and(eq(payrollPf.runId, runId), eq(payrollPf.tenantId, tenantId), eq(payrollPf.epsBasis, "default"), notExcludedSlip(payrollPf.slipId)));
  return [...new Set(rows.map((r) => r.employeeId))];
}

export async function epsUnrecordedEmployeeIdsByRun(runId: string, tenantId: string): Promise<string[]> {
  return scopedRead((tx) => epsUnrecordedEmployeeIdsByRunTx(tx as unknown as Writer, runId, tenantId));
}

export async function upsPoolForSlip(tenantId: string, slipId: string): Promise<Array<{ contribMinor: bigint }>> {
  return scopedRead((tx) => tx.select({ contribMinor: payrollUpsPool.contribMinor }).from(payrollUpsPool)
    .where(and(eq(payrollUpsPool.tenantId, tenantId), eq(payrollUpsPool.slipId, slipId))));
}

export async function adminTopUpForPeriod(tenantId: string, period: string) {
  // The latest close of the month (append-only rows, one per approved run set).
  const rows = await scopedRead((tx) => tx.select().from(payrollEpfAdminTopups)
    .where(and(eq(payrollEpfAdminTopups.tenantId, tenantId), eq(payrollEpfAdminTopups.period, period)))
    .orderBy(desc(payrollEpfAdminTopups.createdAt)).limit(1));
  return rows[0] ?? null;
}

export async function insertUpsPool(tx: Writer, row: typeof payrollUpsPool.$inferInsert): Promise<void> {
  await tx.insert(payrollUpsPool).values(row);
}

/**
 * UAT b18 (ERP-head decision 2026-11-05): employer amounts payable that are
 * NOT in sumEmployerContribByRunTx and are accrued as their own GL lines on
 * payroll.run.approved -- EDLI (EPFO A/c 21) and EPF admin charges (A/c 2)
 * from the PF ledger, and the Government 8.5% UPS pool share. Per run, per
 * member; the A/c 2 Rs 500 establishment minimum is a challan-level figure
 * (pf/challan), not accrued per run. Read through the caller's tx.
 */
export async function sumEmployerChargesByRunTx(tx: Writer, runId: string, tenantId: string): Promise<{ edliMinor: bigint; epfAdminMinor: bigint; upsPoolMinor: bigint }> {
  const [pf] = await tx.select({
    edli: sql<string>`coalesce(sum(${payrollPf.edliContribMinor}), 0)`,
    admin: sql<string>`coalesce(sum(${payrollPf.epfAdminMinor}), 0)`,
  }).from(payrollPf).where(and(eq(payrollPf.runId, runId), eq(payrollPf.tenantId, tenantId), notExcludedSlip(payrollPf.slipId)));
  const [ups] = await tx.select({ pool: sql<string>`coalesce(sum(${payrollUpsPool.contribMinor}), 0)` })
    .from(payrollUpsPool).where(and(eq(payrollUpsPool.runId, runId), eq(payrollUpsPool.tenantId, tenantId), notExcludedSlip(payrollUpsPool.slipId)));
  return { edliMinor: BigInt(pf?.edli ?? 0), epfAdminMinor: BigInt(pf?.admin ?? 0), upsPoolMinor: BigInt(ups?.pool ?? 0) };
}

/**
 * GAP-PAYROLL-STATUTORY-PF-03 / ESI-03: PF/ESI ledger reads are ordered
 * (newest period first, then id for a stable page) and can be narrowed to one
 * "YYYY-MM" period, so a page showing "one month" asks the database for that
 * month instead of filtering an arbitrary, unordered first page client-side.
 */
export async function listPfByTenant(tenantId: string, limit = 100, period?: string) {
  const where = and(period ? and(eq(payrollPf.tenantId, tenantId), eq(payrollPf.period, period)) : eq(payrollPf.tenantId, tenantId), notExcludedSlip(payrollPf.slipId));
  return scopedRead((tx) => tx.select().from(payrollPf).where(where).orderBy(desc(payrollPf.period), payrollPf.id).limit(limit));
}

export async function listEsiByTenant(tenantId: string, limit = 100, period?: string) {
  const where = and(period ? and(eq(payrollEsi.tenantId, tenantId), eq(payrollEsi.period, period)) : eq(payrollEsi.tenantId, tenantId), notExcludedSlip(payrollEsi.slipId));
  return scopedRead((tx) => tx.select().from(payrollEsi).where(where).orderBy(desc(payrollEsi.period), payrollEsi.id).limit(limit));
}

/** Most periods a ledger summary lists for its period picker (10 years of months). */
export const LEDGER_SUMMARY_MAX_PERIODS = 120;

export type LedgerPeriodSummary = {
  /** Distinct periods present for the tenant, newest first. */
  periods: string[];
  /** The summarised period: the requested one if present, else the latest; null when the ledger is empty. */
  period: string | null;
  recordCount: number;
  empContribMinor: bigint;
  erContribMinor: bigint;
};

/**
 * GAP-PAYROLL-STATUTORY-PF-03 / ESI-03: exact per-period totals computed in
 * SQL (COUNT/SUM over every row of the period), independent of any list page
 * size, plus the distinct period list for the picker.
 */
async function ledgerPeriodSummary(
  tbl: typeof payrollPf | typeof payrollEsi,
  tenantId: string,
  requested?: string,
): Promise<LedgerPeriodSummary> {
  return scopedRead(async (tx) => {
    const periodRows = await tx.selectDistinct({ period: tbl.period }).from(tbl)
      .where(and(eq(tbl.tenantId, tenantId), notExcludedSlip(tbl.slipId)))
      .orderBy(desc(tbl.period))
      .limit(LEDGER_SUMMARY_MAX_PERIODS);
    const periods = periodRows.map((r: { period: string }) => r.period);
    const period = requested && periods.includes(requested) ? requested : (periods[0] ?? null);
    if (!period) return { periods, period: null, recordCount: 0, empContribMinor: 0n, erContribMinor: 0n };
    const [agg] = await tx.select({
      n: sql<string>`count(*)`,
      emp: sql<string>`coalesce(sum(${tbl.empContribMinor}), 0)`,
      er: sql<string>`coalesce(sum(${tbl.erContribMinor}), 0)`,
    }).from(tbl).where(and(eq(tbl.tenantId, tenantId), eq(tbl.period, period), notExcludedSlip(tbl.slipId)));
    return {
      periods,
      period,
      recordCount: Number(agg?.n ?? 0),
      empContribMinor: BigInt(agg?.emp ?? 0),
      erContribMinor: BigInt(agg?.er ?? 0),
    };
  });
}

export async function summarisePfPeriod(tenantId: string, period?: string): Promise<LedgerPeriodSummary> {
  return ledgerPeriodSummary(payrollPf, tenantId, period);
}

/** UAT b18 D5: the EPF ledger totals one ECR / challan for a wage month is made of. */
export type PfChallanTotals = {
  recordCount: number;
  empContribMinor: bigint;
  epsContribMinor: bigint;
  epfErContribMinor: bigint;
  edliContribMinor: bigint;
  epfAdminMinor: bigint;
  epfWageMinor: bigint;
  edliWageMinor: bigint;
};

/** Sums of the PF ledger for one period (excluded slips never count). */
export async function sumPfChallanPeriod(tenantId: string, period: string): Promise<PfChallanTotals> {
  return scopedRead(async (tx) => {
    const [agg] = await tx.select({
      n: sql<string>`count(*)`,
      emp: sql<string>`coalesce(sum(${payrollPf.empContribMinor}), 0)`,
      eps: sql<string>`coalesce(sum(${payrollPf.epsContribMinor}), 0)`,
      epfEr: sql<string>`coalesce(sum(${payrollPf.epfErContribMinor}), 0)`,
      edli: sql<string>`coalesce(sum(${payrollPf.edliContribMinor}), 0)`,
      admin: sql<string>`coalesce(sum(${payrollPf.epfAdminMinor}), 0)`,
      epfWage: sql<string>`coalesce(sum(${payrollPf.epfWageMinor}), 0)`,
      edliWage: sql<string>`coalesce(sum(${payrollPf.edliWageMinor}), 0)`,
    }).from(payrollPf).where(and(eq(payrollPf.tenantId, tenantId), eq(payrollPf.period, period), notExcludedSlip(payrollPf.slipId)));
    return {
      recordCount: Number(agg?.n ?? 0),
      empContribMinor: BigInt(agg?.emp ?? 0),
      epsContribMinor: BigInt(agg?.eps ?? 0),
      epfErContribMinor: BigInt(agg?.epfEr ?? 0),
      edliContribMinor: BigInt(agg?.edli ?? 0),
      epfAdminMinor: BigInt(agg?.admin ?? 0),
      epfWageMinor: BigInt(agg?.epfWage ?? 0),
      edliWageMinor: BigInt(agg?.edliWage ?? 0),
    };
  });
}

export async function summariseEsiPeriod(tenantId: string, period?: string): Promise<LedgerPeriodSummary> {
  return ledgerPeriodSummary(payrollEsi, tenantId, period);
}

export async function listTdsByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollTds).where(and(eq(payrollTds.tenantId, tenantId), notExcludedSlip(payrollTds.slipId))).limit(limit));
}

export async function listGratuityByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollGratuity).where(eq(payrollGratuity.tenantId, tenantId)).limit(limit));
}

export async function listGpfByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollGpf).where(and(eq(payrollGpf.tenantId, tenantId), notExcludedSlip(payrollGpf.slipId))).limit(limit));
}

export async function listNpsByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollNps).where(and(eq(payrollNps.tenantId, tenantId), notExcludedSlip(payrollNps.slipId))).limit(limit));
}

/**
 * Total EMPLOYER statutory contributions for a run (employer PF incl. EPS, employer
 * ESI, employer NPS), in paise. Used by finance to accrue the employer-cost legs.
 */
export async function sumEmployerContribByRun(runId: string, tenantId: string): Promise<bigint> {
  const sumOf = async (tbl: typeof payrollPf | typeof payrollEsi | typeof payrollNps): Promise<bigint> => {
    const rows = await scopedRead((tx) => tx.select({ v: tbl.erContribMinor }).from(tbl)
      .where(and(eq(tbl.runId, runId), eq(tbl.tenantId, tenantId), notExcludedSlip(tbl.slipId))));
    return rows.reduce((s: bigint, r: { v: bigint }) => s + (r.v ?? 0n), 0n);
  };
  // payrollPf.erContribMinor is the full employer 12% (EPS + EPF-er); do not also
  // add epfErContribMinor or it double-counts.
  return (await sumOf(payrollPf)) + (await sumOf(payrollEsi)) + (await sumOf(payrollNps));
}

/**
 * Transaction-scoped variant of sumEmployerContribByRun, reading through the
 * caller's already-open `tx` instead of scopedRead's own nested
 * `db.transaction()`. payroll/consumer.ts's `runApprove` handler called the
 * scopedRead-based version from inside its own open transaction -- a second
 * transaction competing for a connection from the SAME pool as the outer one,
 * which deadlocks every in-flight approval once concurrent approvals reach
 * pool.max (the same bug class fixed in notification-service PR #1028 and
 * building-service PR #1035; see the production-readiness-audit skill,
 * .claude/skills/16-production-readiness-audit.md, section 1).
 */
export async function sumEmployerContribByRunTx(tx: Writer, runId: string, tenantId: string): Promise<bigint> {
  const sumOf = async (tbl: typeof payrollPf | typeof payrollEsi | typeof payrollNps): Promise<bigint> => {
    const rows = await tx.select({ v: tbl.erContribMinor }).from(tbl)
      .where(and(eq(tbl.runId, runId), eq(tbl.tenantId, tenantId), notExcludedSlip(tbl.slipId)));
    return rows.reduce((s: bigint, r: { v: bigint }) => s + (r.v ?? 0n), 0n);
  };
  return (await sumOf(payrollPf)) + (await sumOf(payrollEsi)) + (await sumOf(payrollNps));
}

/**
 * UAT P3 b19 D-10: run totals of the EMPLOYEE statutory deductions, in paise,
 * over non-excluded slips (same filter as the employer sum above), read through
 * the caller transaction. pf is the EPF employee share (emp_contrib_minor, the
 * employee 12%); the employer columns are never read here.
 */
export async function sumEmployeeStatutoryByRunTx(tx: Writer, runId: string, tenantId: string): Promise<{
  tdsMinor: bigint; gpfMinor: bigint; npsMinor: bigint; pfMinor: bigint; esiMinor: bigint;
}> {
  const total = (rows: Array<{ v: bigint | null }>): bigint => rows.reduce((s, r) => s + (r.v ?? 0n), 0n);
  const emp = async (tbl: typeof payrollPf | typeof payrollEsi | typeof payrollNps | typeof payrollGpf): Promise<bigint> =>
    total(await tx.select({ v: tbl.empContribMinor }).from(tbl)
      .where(and(eq(tbl.runId, runId), eq(tbl.tenantId, tenantId), notExcludedSlip(tbl.slipId))));
  const tdsMinor = total(await tx.select({ v: payrollTds.tdsMinor }).from(payrollTds)
    .where(and(eq(payrollTds.runId, runId), eq(payrollTds.tenantId, tenantId), notExcludedSlip(payrollTds.slipId))));
  return { tdsMinor, gpfMinor: await emp(payrollGpf), npsMinor: await emp(payrollNps), pfMinor: await emp(payrollPf), esiMinor: await emp(payrollEsi) };
}
