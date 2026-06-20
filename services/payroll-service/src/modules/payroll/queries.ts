import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PayrollSlipRow, PayrollRunRow } from "./schema.js";

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

export async function listRuns(tenantId: string, limit: number): Promise<{ data: Array<{ month: string; grossDisplay: string; status: "In Processing" | "Completed" | "Failed" }> }> {
  const rows = await repo.listRunsByTenant(tenantId, limit);
  return {
    data: rows.map((r) => ({
      month: r.month,
      grossDisplay: `₹${(Number(r.totalGrossMinor) / 100).toLocaleString("en-IN")}`,
      status: r.status === "completed" || r.status === "disbursed" ? "Completed" as const
        : r.status === "failed" ? "Failed" as const : "In Processing" as const,
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
    gross: Number(r.grossMinor) / 100,
    deductions: Number(r.totalDeductionsMinor) / 100,
    net: Number(r.netPayMinor) / 100,
    status: (r.status === "paid" ? "paid" : r.status === "finalized" ? "finalized" : "draft") as "draft" | "finalized" | "paid",
  }));
}
