import * as repo from "./repo.js";
import { fetchEmployeeSummaries, fetchNpsPranLast4 } from "../../shared/hrms-client.js";
import { fetchRetirementAccounts } from "../../shared/hrms-retirement-client.js";
import { reconcileGpf, reconcileNps, type HrmsCoverage } from "./reconcile.js";

export async function listPfReport(tenantId: string, limit: number, period?: string) {
  // GAP-PAYROLL-STATUTORY-PF-04: same best-effort employeeName enrichment
  // listGpfReport/listNpsReport already use (see UX-021 below) --
  // fetchEmployeeSummaries fails open to an empty Map on an unreachable
  // HRMS, so this never gates the report; null just means the frontend
  // falls back to the employeeId it already shows.
  const [rows, empMap] = await Promise.all([
    repo.listPfByTenant(tenantId, limit, period),
    fetchEmployeeSummaries(tenantId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: empMap.get(r.employeeId)?.fullName ?? null,
    period: r.period,
    basicMinor: Number(r.basicMinor),
    empContribMinor: Number(r.empContribMinor),
    erContribMinor: Number(r.erContribMinor),
  }));
}

export async function listEsiReport(tenantId: string, limit: number, period?: string) {
  // GAP-PAYROLL-STATUTORY-ESI-02: same enrichment as listPfReport above.
  const [rows, empMap] = await Promise.all([
    repo.listEsiByTenant(tenantId, limit, period),
    fetchEmployeeSummaries(tenantId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: empMap.get(r.employeeId)?.fullName ?? null,
    period: r.period,
    grossMinor: Number(r.grossMinor),
    empContribMinor: Number(r.empContribMinor),
    erContribMinor: Number(r.erContribMinor),
  }));
}

export async function listTdsReport(tenantId: string, limit: number) {
  const rows = await repo.listTdsByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    period: r.period,
    taxableMinor: Number(r.taxableMinor),
    tdsMinor: Number(r.tdsMinor),
  }));
}

export async function listGratuityReport(tenantId: string, limit: number) {
  // GAP-PAYROLL-STATUTORY-GRATUITY-06: same best-effort employeeName
  // enrichment as listGpfReport below (fails open to null on an unreachable
  // HRMS; the page then falls back to the employeeId).
  const [rows, empMap] = await Promise.all([
    repo.listGratuityByTenant(tenantId, limit),
    fetchEmployeeSummaries(tenantId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: empMap.get(r.employeeId)?.fullName ?? null,
    yearsOfService: r.yearsOfService,
    gratuityMinor: Number(r.gratuityMinor),
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
  const [rows, empMap, accounts] = await Promise.all([
    repo.listGpfByTenant(tenantId, limit),
    fetchEmployeeSummaries(tenantId),
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
    basicMinor: Number(r.basicMinor),
    // payroll_gpf.contrib_pct is a Drizzle `numeric` column, which the
    // driver returns as a string ("10.00"); send a number so clients can
    // format it as a percent.
    contribPct: Number(r.contribPct),
    empContribMinor: Number(r.empContribMinor),
    // GAP-PAYROLL-STATUTORY-GPF-02: flags divergence from the hrms-service GPF account.
    reconciliation: reconcileGpf(BigInt(r.empContribMinor), accounts?.gpf.get(r.employeeId), coverageOf(accounts, accounts?.gpfTruncated)),
  }));
}

export async function listNpsReport(tenantId: string, limit: number) {
  // UX-021: see listGpfReport above -- same best-effort employeeName enrichment.
  const [rows, empMap, pranMap, accounts] = await Promise.all([
    repo.listNpsByTenant(tenantId, limit),
    fetchEmployeeSummaries(tenantId),
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
    basicMinor: Number(r.basicMinor),
    empContribPct: r.empContribPct,
    erContribPct: r.erContribPct,
    empContribMinor: Number(r.empContribMinor),
    erContribMinor: Number(r.erContribMinor),
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

export async function esiPeriodSummary(tenantId: string, period?: string) {
  return serialiseSummary(await repo.summariseEsiPeriod(tenantId, period));
}
