import { eq, and, desc, sql, type AnyColumn } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollPf, payrollTds, payrollEsi, payrollGratuity, payrollGpf, payrollNps } from "./schema.js";

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

type LedgerKey = "pf" | "esi" | "nps" | "gpf" | "tds";
/**
 * Business columns of each ledger, as returned by the DELETE (fixed lists:
 * no PII, nothing beyond the employee id) -- enough to rebuild every removed
 * row from the audit trail: wage bases, shares, PF EPF / EPS split, TDS.
 */
const LEDGER_AUDIT_COLUMNS: Record<LedgerKey, { scheme: string; columns: string[] }> = {
  pf:  { scheme: "EPF", columns: ["basic_minor", "emp_contrib_pct", "er_contrib_pct", "emp_contrib_minor", "er_contrib_minor", "eps_contrib_minor", "epf_er_contrib_minor"] },
  esi: { scheme: "ESI", columns: ["gross_minor", "emp_contrib_minor", "er_contrib_minor"] },
  nps: { scheme: "NPS", columns: ["basic_minor", "pension_base_minor", "emp_contrib_pct", "er_contrib_pct", "emp_contrib_minor", "er_contrib_minor"] },
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
  const counts: Record<LedgerKey, number> = { pf: 0, esi: 0, nps: 0, gpf: 0, tds: 0 };
  const rows: RemovedLedgerRow[] = [];
  for (const k of Object.keys(counts) as LedgerKey[]) {
    const { scheme, columns } = LEDGER_AUDIT_COLUMNS[k];
    const returning = ["slip_id", "employee_id", "run_id", "period", "currency", ...columns].map((c) => `${c}::text AS ${c}`).join(", ");
    const removed = (await tx.execute(sql`DELETE FROM ${sql.raw(`statutory.payroll_${k}`)}
      WHERE slip_id = ${slipId}::uuid AND tenant_id = ${tenantId}::uuid RETURNING ${sql.raw(returning)}`)) as unknown as Array<Record<string, string | null>>;
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
