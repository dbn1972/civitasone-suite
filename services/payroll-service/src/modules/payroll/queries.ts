import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PayrollRunRow, PayrollSlipRow } from "./schema.js";
import type { SlipWithRun } from "./repo.js";
import { fetchEmployeeSummaries } from "../../shared/hrms-client.js";

function mapRunStatus(status: string): "draft" | "processing" | "completed" | "paid" {
  if (status === "disbursed") return "paid";
  if (status === "approved") return "completed";
  if (status === "processing") return "processing";
  if (status === "draft") return "draft";
  if (status === "failed") return "draft";
  return "processing";
}

export async function getSlip(id: string, tenantId: string): Promise<PayrollSlipRow | null> {
  return cache.getOrLoad<PayrollSlipRow>(
    cache.makeKey(tenantId, "payroll_slip", id),
    () => repo.findSlipById(id, tenantId)
  );
}

export async function getRun(id: string, tenantId: string): Promise<PayrollRunRow | null> {
  return repo.findRunById(id, tenantId);
}

export async function listRuns(tenantId: string, limit: number) {
  const rows = await repo.listRunsByTenant(tenantId, limit);
  return Promise.all(rows.map(async (r) => {
    const slips = await repo.listSlipsByRun(r.id, tenantId);
    return {
      id: r.id,
      runDate: new Date(r.createdAt as unknown as string).toISOString().slice(0, 10),
      payPeriod: r.month,
      employeeCount: slips.length,
      grossAmount: Number(r.totalGrossMinor) / 100,
      netAmount: Number(r.totalNetMinor) / 100,
      deductions: Math.max(0, Number(r.totalGrossMinor - r.totalNetMinor) / 100),
      status: mapRunStatus(r.status),
    };
  }));
}

export async function getRunDetail(id: string, tenantId: string) {
  const run = await getRun(id, tenantId);
  if (!run) return null;
  const runSlips = await repo.listSlipsByRun(id, tenantId);
  return {
    id: run.id,
    runDate: new Date(run.createdAt as unknown as string).toISOString().slice(0, 10),
    payPeriod: run.month,
    employeeCount: runSlips.length,
    grossAmount: Number(run.totalGrossMinor) / 100,
    netAmount: Number(run.totalNetMinor) / 100,
    deductions: Math.max(0, Number(run.totalGrossMinor - run.totalNetMinor) / 100),
    status: mapRunStatus(run.status),
    // BUG-2 fix: this payload's grossAmount/netAmount/deductions above are
    // already rupees (/100 of the minor-unit column), and the frontend's
    // run-detail view (SalarySlipsClientTable.tsx) renders these embedded
    // slip fields with formatRupees(), not formatMoney() — i.e. it already
    // expects rupees here too. The old `Number(s.grossMinor)` (raw paise, no
    // /100) was a 100x mismatch against both the sibling run-level fields in
    // this same response and what the frontend actually does with the value.
    // NOT touched: listSalarySlips()/GET /v1/payroll/salary-slips below is a
    // different endpoint, correctly consumed via formatMoney() (paise) by
    // SalarySlipsTable.tsx's DataTable — that convention is independently
    // correct and out of scope here.
    salarySlips: runSlips.map((s) => ({
      id: s.id,
      employeeId: s.employeeId,
      employeeName: s.employeeNo,
      gross: Number(s.grossMinor) / 100,
      deductions: Number(s.totalDeductionsMinor) / 100,
      net: Number(s.netPayMinor) / 100,
      status: s.status,
    })),
  };
}

function formatPayPeriod(month: string): string {
  if (!month || month.length < 7) return month || "—";
  const [y, m] = month.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const idx = parseInt(m ?? "0", 10) - 1;
  return (names[idx] ?? m) + " " + y;
}

export async function listSalarySlips(tenantId: string, limit: number) {
  const [rows, empMap] = await Promise.all([
    repo.listSlipsByTenant(tenantId, limit),
    fetchEmployeeSummaries(tenantId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeNo,
    department: empMap.get(r.employeeId)?.departmentName ?? "—",
    payPeriod: formatPayPeriod(r.month),
    gross: Number(r.grossMinor),
    deductions: Number(r.totalDeductionsMinor),
    net: Number(r.netPayMinor),
    status: (r.status === "paid" ? "paid" : r.status === "finalized" ? "finalized" : "draft") as "draft" | "finalized" | "paid",
  }));
}

export async function listStructures(tenantId: string, limit: number) {
  const rows = await repo.listStructuresByTenant(tenantId, limit);
  return rows.map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault, status: s.status }));
}

export async function listComponents(tenantId: string, limit: number) {
  const rows = await repo.listComponentsByTenant(tenantId, limit);
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    componentType: c.componentType,
    isTaxable: c.isTaxable,
    structureId: c.structureId,
  }));
}
