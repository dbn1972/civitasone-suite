import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

/**
 * NEFT/RTGS bank-transfer file for salary disbursement. Beneficiary account,
 * IFSC and name are sourced from the HRMS employee master (via payroll-input),
 * keyed by employee id; a control-total trailer (record count + total net) is
 * appended so the bank can reconcile the batch before processing.
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

    // Beneficiary bank details. Salary runs source the HRMS employee master;
    // pensioner runs source the pensioner master (keyed by pensioner id, which
    // is the slip's employeeId). Both expose { fullName, bankAccountNo, bankIfsc }.
    type Beneficiary = { fullName: string; bankAccountNo: string | null; bankIfsc: string | null };
    const master = new Map<string, Beneficiary>();
    if (run.runType === "pensioner") {
      const pens = (await db.execute(sql`
        SELECT id, full_name, bank_account_no, bank_ifsc
        FROM payroll.payroll_pensioners
        WHERE tenant_id = ${ctx.tenantId}::uuid
      `)) as unknown as Array<{ id: string; full_name: string; bank_account_no: string | null; bank_ifsc: string | null }>;
      for (const p of pens) master.set(p.id, { fullName: p.full_name, bankAccountNo: p.bank_account_no, bankIfsc: p.bank_ifsc });
    } else {
      const input = await fetchPayrollInput(ctx.tenantId, run.month);
      for (const e of input.employees) master.set(e.id, { fullName: e.fullName, bankAccountNo: e.bankAccountNo, bankIfsc: e.bankIfsc });
    }

    // H4: CSV injection + delimiter safety. Neutralise spreadsheet formula
    // triggers (= + - @, and TAB/CR which Excel also treats as leading) by
    // prefixing with a single quote, then quote/escape per RFC 4180 if the
    // value contains a comma, quote, CR or LF.
    const escapeCsv = (raw: string): string => {
      let val = raw ?? "";
      if (/^[=+\-@\t\r]/.test(val)) val = `'${val}`;
      if (/[",\r\n]/.test(val)) val = `"${val.replace(/"/g, '""')}"`;
      return val;
    };
    const ifscRe = /^[A-Z]{4}0[A-Z0-9]{6}$/; // RBI IFSC format
    const missing: string[] = [];
    let totalNetMinor = 0n;

    const csvRows = slips.map((slip) => {
      const emp = master.get(slip.employeeId);
      const bankAccount = (emp?.bankAccountNo ?? "").trim();
      const ifsc = (emp?.bankIfsc ?? "").trim().toUpperCase();
      const name = emp?.fullName ?? slip.employeeNo;
      if (!bankAccount || !ifscRe.test(ifsc)) missing.push(slip.employeeNo);
      totalNetMinor += slip.netPayMinor;

      const netPay = (Number(slip.netPayMinor) / 100).toFixed(2);
      const narration = `Salary ${run.month} ${slip.employeeNo}`;
      return [
        escapeCsv(slip.employeeNo),
        escapeCsv(name),
        escapeCsv(bankAccount),
        escapeCsv(ifsc),
        netPay,
        escapeCsv(narration),
      ].join(",");
    });

    // Refuse to emit a file with unusable beneficiary rows — the bank would
    // reject the whole batch, and a partial file risks silent under-payment.
    if (missing.length > 0) {
      throw new HttpError(422, "BANK_DETAILS_MISSING",
        `missing or invalid bank account/IFSC for: ${missing.join(", ")}`);
    }

    const csvHeader = "Employee No,Name,Bank Account,IFSC,Net Pay Amount,Narration";
    const trailer = `TRAILER,${slips.length},,,${(Number(totalNetMinor) / 100).toFixed(2)},Control total`;
    const csvContent = [csvHeader, ...csvRows, trailer].join("\r\n");
    const filename = `bank_transfer_${run.runNo}_${run.month}.csv`;

    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(csvContent);
  });
}
