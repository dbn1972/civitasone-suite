import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

/**
 * Bank transfer file generation for NEFT/RTGS disbursement.
 * Generates CSV with: Employee No, Name, Bank Account, IFSC, Net Pay Amount, Narration
 */
export async function bankTransferRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/runs/:id/bank-file", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);

    const { id } = req.params as { id: string };

    // Verify the run exists and belongs to this tenant
    const runRows = await db.select().from(payrollRuns)
      .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, ctx.tenantId)))
      .limit(1);
    const run = runRows[0];
    if (!run) throw new HttpError(404, "NOT_FOUND", "payroll run not found");

    if (run.status !== "approved" && run.status !== "disbursed") {
      throw new HttpError(400, "INVALID_STATE", "bank file can only be generated for approved or disbursed runs");
    }

    // Fetch all slips for this run
    const slips = await db.select().from(payrollSlips)
      .where(and(eq(payrollSlips.runId, id), eq(payrollSlips.tenantId, ctx.tenantId)));

    if (slips.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "no salary slips found for this run");
    }

    // Build CSV
    const csvHeader = "Employee No,Name,Bank Account,IFSC,Net Pay Amount,Narration";
    const csvRows = slips.map((slip) => {
      const netPay = (Number(slip.netPayMinor) / 100).toFixed(2);
      const narration = `Salary ${run.month} ${slip.employeeNo}`;
      // Bank account and IFSC would come from employee master — placeholder from components metadata
      const bankAccount = "";
      const ifsc = "";
      const name = slip.employeeNo; // Employee name from HR service lookup

      // Escape CSV fields containing commas
      const escapeCsv = (val: string) => val.includes(",") ? `"${val}"` : val;

      return [
        escapeCsv(slip.employeeNo),
        escapeCsv(name),
        escapeCsv(bankAccount),
        escapeCsv(ifsc),
        netPay,
        escapeCsv(narration),
      ].join(",");
    });

    const csvContent = [csvHeader, ...csvRows].join("\r\n");
    const filename = `bank_transfer_${run.runNo}_${run.month}.csv`;

    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(csvContent);
  });
}
