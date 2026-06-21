import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PayrollSlipRow, PayrollRunRow } from "./schema.js";

function mapRunStatus(status: string): "draft" | "processing" | "completed" | "paid" {
  if (status === "disbursed" || status === "completed") return "completed";
  if (status === "approved") return "completed";
  if (status === "processing") return "processing";
  if (status === "draft") return "draft";
  return "processing";
}

export async function getSlip(id: string, tenantId: string): Promise<PayrollSlipRow | null> {
  return cache.getOrLoad<PayrollSlipRow>(
    cache.makeKey(tenantId, "payroll_slip", id),
    () => repo.findSlipById(id, tenantId)
  );
}

export async function getRun(id: string, tenantId: string): Promise<PayrollRunRow | null> {
  return cache.getOrLoad<PayrollRunRow>(
    cache.makeKey(tenantId, "payroll_run", id),
    () => repo.findRunById(id, tenantId)
  );
}

export async function listRuns(tenantId: string, limit: number) {
  const rows = await repo.listRunsByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    runDate: r.createdAt.toISOString().slice(0, 10),
    payPeriod: r.month,
    employeeCount: 0,
    grossAmount: Number(r.totalGrossMinor) / 100,
    netAmount: Number(r.totalNetMinor) / 100,
    deductions: Math.max(0, Number(r.totalGrossMinor - r.totalNetMinor) / 100),
    status: mapRunStatus(r.status),
  }));
}

export async function getRunDetail(id: string, tenantId: string) {
  const run = await getRun(id, tenantId);
  if (!run) return null;
  const slips = await repo.listSlipsByTenant(tenantId, 500);
  const runSlips = slips.filter((s) => s.runId === id);
  return {
    id: run.id,
    runDate: run.createdAt.toISOString().slice(0, 10),
    payPeriod: run.month,
    employeeCount: runSlips.length,
    grossAmount: Number(run.totalGrossMinor) / 100,
    netAmount: Number(run.totalNetMinor) / 100,
    deductions: Math.max(0, Number(run.totalGrossMinor - run.totalNetMinor) / 100),
    status: mapRunStatus(run.status),
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

export async function listSalarySlips(tenantId: string, limit: number) {
  const rows = await repo.listSlipsByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employeeNo,
    department: "",
    payPeriod: r.runId.slice(0, 8),
    gross: Number(r.grossMinor),
    deductions: Number(r.totalDeductionsMinor),
    net: Number(r.netPayMinor),
    status: (r.status === "paid" ? "paid" : r.status === "finalized" ? "finalized" : "draft") as "draft" | "finalized" | "paid",
  }));
}
