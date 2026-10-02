import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollPf, payrollTds, payrollEsi, payrollGratuity, payrollGpf, payrollNps } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

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
  const where = period ? and(eq(payrollPf.tenantId, tenantId), eq(payrollPf.period, period)) : eq(payrollPf.tenantId, tenantId);
  return scopedRead((tx) => tx.select().from(payrollPf).where(where).orderBy(desc(payrollPf.period), payrollPf.id).limit(limit));
}

export async function listEsiByTenant(tenantId: string, limit = 100, period?: string) {
  const where = period ? and(eq(payrollEsi.tenantId, tenantId), eq(payrollEsi.period, period)) : eq(payrollEsi.tenantId, tenantId);
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
      .where(eq(tbl.tenantId, tenantId))
      .orderBy(desc(tbl.period))
      .limit(LEDGER_SUMMARY_MAX_PERIODS);
    const periods = periodRows.map((r: { period: string }) => r.period);
    const period = requested && periods.includes(requested) ? requested : (periods[0] ?? null);
    if (!period) return { periods, period: null, recordCount: 0, empContribMinor: 0n, erContribMinor: 0n };
    const [agg] = await tx.select({
      n: sql<string>`count(*)`,
      emp: sql<string>`coalesce(sum(${tbl.empContribMinor}), 0)`,
      er: sql<string>`coalesce(sum(${tbl.erContribMinor}), 0)`,
    }).from(tbl).where(and(eq(tbl.tenantId, tenantId), eq(tbl.period, period)));
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
  return scopedRead((tx) => tx.select().from(payrollTds).where(eq(payrollTds.tenantId, tenantId)).limit(limit));
}

export async function listGratuityByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollGratuity).where(eq(payrollGratuity.tenantId, tenantId)).limit(limit));
}

export async function listGpfByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollGpf).where(eq(payrollGpf.tenantId, tenantId)).limit(limit));
}

export async function listNpsByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollNps).where(eq(payrollNps.tenantId, tenantId)).limit(limit));
}

/**
 * Total EMPLOYER statutory contributions for a run (employer PF incl. EPS, employer
 * ESI, employer NPS), in paise. Used by finance to accrue the employer-cost legs.
 */
export async function sumEmployerContribByRun(runId: string, tenantId: string): Promise<bigint> {
  const sumOf = async (tbl: typeof payrollPf | typeof payrollEsi | typeof payrollNps): Promise<bigint> => {
    const rows = await scopedRead((tx) => tx.select({ v: tbl.erContribMinor }).from(tbl)
      .where(and(eq(tbl.runId, runId), eq(tbl.tenantId, tenantId))));
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
      .where(and(eq(tbl.runId, runId), eq(tbl.tenantId, tenantId)));
    return rows.reduce((s: bigint, r: { v: bigint }) => s + (r.v ?? 0n), 0n);
  };
  return (await sumOf(payrollPf)) + (await sumOf(payrollEsi)) + (await sumOf(payrollNps));
}
