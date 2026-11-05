import { minorToWireNumber } from "../../shared/money.js";
import * as repo from "./repo.js";
import { scopedRead } from "../../shared/db.js";

import { epfAdminChargeForPeriod } from "../payroll/domain.js";
import { fetchEmployeeSummaries, fetchNpsPranLast4 } from "../../shared/hrms-client.js";
import { fetchRetirementAccounts } from "../../shared/hrms-retirement-client.js";
import { reconcileGpf, reconcileNps, type HrmsCoverage } from "./reconcile.js";

export async function listPfReport(tenantId: string, limit: number, period?: string) {
  // GAP-PAYROLL-STATUTORY-PF-04: same best-effort employeeName enrichment
  // listGpfReport/listNpsReport already use (see UX-021 below) --
  // fetchEmployeeSummaries fails open to an empty Map on an unreachable
  // HRMS, so this never gates the report; null just means the frontend
  // falls back to the employeeId it already shows.
  const rows = await repo.listPfByTenant(tenantId, limit, period);
  const empMap = await fetchEmployeeSummaries(tenantId, rows.map((r) => r.employeeId));
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: empMap.get(r.employeeId)?.fullName ?? null,
    period: r.period,
    basicMinor: minorToWireNumber(r.basicMinor),
    empContribMinor: minorToWireNumber(r.empContribMinor),
    erContribMinor: minorToWireNumber(r.erContribMinor),
  }));
}

export async function listEsiReport(tenantId: string, limit: number, period?: string) {
  // GAP-PAYROLL-STATUTORY-ESI-02: same enrichment as listPfReport above.
  const rows = await repo.listEsiByTenant(tenantId, limit, period);
  const empMap = await fetchEmployeeSummaries(tenantId, rows.map((r) => r.employeeId));
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: empMap.get(r.employeeId)?.fullName ?? null,
    period: r.period,
    grossMinor: minorToWireNumber(r.grossMinor),
    empContribMinor: minorToWireNumber(r.empContribMinor),
    erContribMinor: minorToWireNumber(r.erContribMinor),
  }));
}

export async function listTdsReport(tenantId: string, limit: number) {
  const rows = await repo.listTdsByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    period: r.period,
    taxableMinor: minorToWireNumber(r.taxableMinor),
    tdsMinor: minorToWireNumber(r.tdsMinor),
  }));
}

export async function listGratuityReport(tenantId: string, limit: number) {
  // GAP-PAYROLL-STATUTORY-GRATUITY-06: same best-effort employeeName
  // enrichment as listGpfReport below (fails open to null on an unreachable
  // HRMS; the page then falls back to the employeeId).
  const rows = await repo.listGratuityByTenant(tenantId, limit);
  const empMap = await fetchEmployeeSummaries(tenantId, rows.map((r) => r.employeeId));
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: empMap.get(r.employeeId)?.fullName ?? null,
    yearsOfService: r.yearsOfService,
    gratuityMinor: minorToWireNumber(r.gratuityMinor),
    status: r.status,
  }));
}

function coverageOf(accounts: unknown, truncated: boolean | undefined): HrmsCoverage {
  if (!accounts) return "unavailable";
  return truncated ? "partial" : "complete";
}

export async function listGpfReport(tenantId: string, limit: number) {
  // UX-021: enrich with employeeName the same best-effort way payroll/
  // queries.ts#getSlip already does -- fetchEmployeeSummaries fails open to
  // an empty Map on an unreachable HRMS, so this never gates the report.
  // null here just means the frontend falls back to the employeeId it
  // already shows (see hr/payroll/gpf/page.tsx).
  const rows = await repo.listGpfByTenant(tenantId, limit);
  const [empMap, accounts] = await Promise.all([
    fetchEmployeeSummaries(tenantId, rows.map((r) => r.employeeId)),
    fetchRetirementAccounts(tenantId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: empMap.get(r.employeeId)?.fullName ?? null,
    // GAP-PAYROLL-GPF-02: the real HR employee number (best-effort, null when
    // HRMS has no match) -- replaces the web's fabricated UUID-prefix "code".
    employeeCode: empMap.get(r.employeeId)?.employeeNo ?? null,
    period: r.period,
    basicMinor: minorToWireNumber(r.basicMinor),
    // payroll_gpf.contrib_pct is a Drizzle `numeric` column, which the
    // driver returns as a string ("10.00"); send a number so clients can
    // format it as a percent.
    contribPct: Number(r.contribPct),
    empContribMinor: minorToWireNumber(r.empContribMinor),
    // GAP-PAYROLL-STATUTORY-GPF-02: flags divergence from the hrms-service GPF account.
    reconciliation: reconcileGpf(BigInt(r.empContribMinor), accounts?.gpf.get(r.employeeId), coverageOf(accounts, accounts?.gpfTruncated)),
  }));
}

export async function listNpsReport(tenantId: string, limit: number) {
  // UX-021: see listGpfReport above -- same best-effort employeeName enrichment.
  const rows = await repo.listNpsByTenant(tenantId, limit);
  const [empMap, pranMap, accounts] = await Promise.all([
    fetchEmployeeSummaries(tenantId, rows.map((r) => r.employeeId)),
    fetchNpsPranLast4(tenantId),
    fetchRetirementAccounts(tenantId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: empMap.get(r.employeeId)?.fullName ?? null,
    // GAP-PAYROLL-NPS-02: real employee number + masked PRAN (last 4 only).
    employeeCode: empMap.get(r.employeeId)?.employeeNo ?? null,
    pranLast4: pranMap.get(r.employeeId) ?? null,
    period: r.period,
    basicMinor: minorToWireNumber(r.basicMinor),
    // GAP-PAYROLL-STATUTORY-NPS-05: the base the percentages were applied to
    // (Basic + DA). null for rows written before migration 0159 -- not guessed.
    pensionBaseMinor: r.pensionBaseMinor == null ? null : minorToWireNumber(r.pensionBaseMinor),
    empContribPct: r.empContribPct,
    erContribPct: r.erContribPct,
    empContribMinor: minorToWireNumber(r.empContribMinor),
    erContribMinor: minorToWireNumber(r.erContribMinor),
    // GAP-PAYROLL-STATUTORY-NPS-02: flags divergence from the hrms-service NPS account.
    reconciliation: reconcileNps(Number(r.empContribPct), Number(r.erContribPct), accounts?.nps.get(r.employeeId), coverageOf(accounts, accounts?.npsTruncated)),
  }));
}

/**
 * GAP-PAYROLL-STATUTORY-PF-03 / ESI-03: per-period ledger summary for the
 * PF/ESI pages' stat tiles. Money stays bigint paise end to end and is sent
 * as a decimal string (JSON has no bigint).
 */
function serialiseSummary(s: repo.LedgerPeriodSummary) {
  return {
    periods: s.periods,
    period: s.period,
    recordCount: s.recordCount,
    empContribMinor: s.empContribMinor.toString(),
    erContribMinor: s.erContribMinor.toString(),
    totalContribMinor: (s.empContribMinor + s.erContribMinor).toString(),
  };
}

export async function pfPeriodSummary(tenantId: string, period?: string) {
  return serialiseSummary(await repo.summarisePfPeriod(tenantId, period));
}

/**
 * UAT b18 D5: the EPFO challan for one wage month, from the PF ledger.
 *   A/c 1  EPF: employee share + employer EPF (EPF-EPS difference)
 *   A/c 2  EPF administrative charges (sum of member charges, at least the
 *          configured statutory minimum when there is any member)
 *   A/c 10 EPS (employer)
 *   A/c 21 EDLI contribution (employer)
 *   A/c 22 EDLI administrative charges: 0 (waived by EPFO since 2017-04-01;
 *          not configurable here)
 * A/c 2 and A/c 21 are employer cost only -- never deducted from the employee.
 */
export async function pfChallanSummary(tenantId: string, period: string) {
  const t = await repo.sumPfChallanPeriod(tenantId, period);
  // Lazy: payroll/consumer.ts imports this module's repo; a static import back would be a cycle.
  const { resolveRunStatutoryConfig } = await import("../payroll/consumer.js");
  const cfg = await scopedRead((tx) => resolveRunStatutoryConfig(tx, tenantId, period));
  const ac1 = t.empContribMinor + t.epfErContribMinor;
  const ac2 = epfAdminChargeForPeriod(t.epfAdminMinor, t.recordCount, cfg);
  const ac10 = t.epsContribMinor;
  const ac21 = t.edliContribMinor;
  const ac22 = 0n;
  return {
    period,
    recordCount: t.recordCount,
    epfWagesMinor: t.epfWageMinor.toString(),
    edliWagesMinor: t.edliWageMinor.toString(),
    employeeShareMinor: t.empContribMinor.toString(),
    accounts: {
      ac1EpfMinor: ac1.toString(),
      ac2AdminMinor: ac2.toString(),
      ac10EpsMinor: ac10.toString(),
      ac21EdliMinor: ac21.toString(),
      ac22EdliAdminMinor: ac22.toString(),
    },
    employerCostMinor: (t.epfErContribMinor + t.epsContribMinor + ac2 + ac21 + ac22).toString(),
    totalChallanMinor: (ac1 + ac2 + ac10 + ac21 + ac22).toString(),
    // Review SF3: the A/c 2 minimum top-up, once the month is closed (POST .../pf/challan/close).
    adminMinimumTopUp: await (async () => {
      const t2 = await repo.adminTopUpForPeriod(tenantId, period);
      return t2 ? { closed: true, topUpMinor: t2.targetTopUpMinor.toString(), journalId: t2.journalId ?? null } : { closed: false, topUpMinor: (ac2 - t.epfAdminMinor).toString(), journalId: null };
    })(),
    rates: {
      edliRateBps: cfg.edliRateBps.toString(),
      edliWageCapMinor: cfg.edliWageCapMinor.toString(),
      epfAdminRateBps: cfg.epfAdminRateBps.toString(),
      epfAdminMinMinor: cfg.epfAdminMinMinor.toString(),
    },
  };
}

/** Review SF7: the Government 8.5% UPS pool share booked for a slip (0 when none). */
export async function upsPoolMinorForSlip(tenantId: string, slipId: string): Promise<bigint> {
  const rows = await repo.upsPoolForSlip(tenantId, slipId);
  return (rows ?? []).reduce((s: bigint, r: { contribMinor: bigint | string | number }) => s + BigInt(r.contribMinor), 0n);
}

export async function esiPeriodSummary(tenantId: string, period?: string) {
  return serialiseSummary(await repo.summariseEsiPeriod(tenantId, period));
}
