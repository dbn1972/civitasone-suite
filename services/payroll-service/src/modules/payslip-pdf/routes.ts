import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, enforceEmployeeOwnership } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { fetchPayrollInput, fetchEmployeeSummaries, HrmsUnavailableError } from "../../shared/hrms-client.js";

const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer", "employee"];

const pathParamSchema = z.object({
  id: z.string().uuid(),
});

/** Default HTML template for salary slip — used when no custom template found */
const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Salary Slip - {{month}}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
  .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
  .header h1 { margin: 0; font-size: 18px; }
  .header h2 { margin: 4px 0 0; font-size: 14px; color: #555; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-bottom: 20px; font-size: 13px; }
  .info-grid dt { font-weight: bold; }
  .info-grid dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; }
  .amount { text-align: right; }
  .total-row { font-weight: bold; background: #f9f9f9; }
  .footer { margin-top: 20px; font-size: 11px; color: #888; text-align: center; }
</style>
</head>
<body>
<div class="header">
  <h1>{{orgName}}</h1>
  <h2>Salary Slip for {{month}}</h2>
</div>
<dl class="info-grid">
  <dt>Employee No</dt><dd>{{employeeNo}}</dd>
  <dt>Name</dt><dd>{{employeeName}}</dd>
  <dt>Department</dt><dd>{{department}}</dd>
  <dt>Designation</dt><dd>{{designation}}</dd>
  <dt>UAN</dt><dd>{{uan}}</dd>
  <dt>PAN</dt><dd>{{pan}}</dd>
  <dt>Bank Account</dt><dd>{{bankAccount}}</dd>
  <dt>IFSC</dt><dd>{{bankIfsc}}</dd>
</dl>
<table>
  <thead><tr><th>Earnings</th><th class="amount">Amount (₹)</th></tr></thead>
  <tbody>{{earningsRows}}</tbody>
  <tfoot><tr class="total-row"><td>Gross Pay</td><td class="amount">{{grossPay}}</td></tr></tfoot>
</table>
<table>
  <thead><tr><th>Deductions</th><th class="amount">Amount (₹)</th></tr></thead>
  <tbody>{{deductionsRows}}
    {{pensionRows}}
  </tbody>
  <tfoot><tr class="total-row"><td>Total Deductions</td><td class="amount">{{totalDeductions}}</td></tr></tfoot>
</table>
<table>
  <tbody><tr class="total-row"><td>Net Pay</td><td class="amount">{{netPay}}</td></tr></tbody>
</table>
<div class="footer">This is a system-generated document and does not require a signature.</div>
</body>
</html>`;

function formatAmount(minor: number | bigint): string {
  return (Number(minor) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export async function payslipPdfRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/slips/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = pathParamSchema.parse(req.params);

    // Fetch the salary slip
    const slipRows = await scopedRead((tx) => tx.select().from(payrollSlips)
      .where(and(eq(payrollSlips.id, id), eq(payrollSlips.tenantId, ctx.tenantId)))
      .limit(1));
    const slip = slipRows[0];
    if (!slip) throw new HttpError(404, "NOT_FOUND", "salary slip not found");

    // SEC-P1-01: a self-service `employee` caller may only download their OWN
    // payslip — without this, any employee could fetch any co-worker's slip
    // (gross/net/PAN/IFSC/UAN) by iterating slip ids.
    enforceEmployeeOwnership(ctx, slip.employeeId);

    // Fetch the run for month info
    const runRows = await scopedRead((tx) => tx.select().from(payrollRuns)
      .where(and(eq(payrollRuns.id, slip.runId), eq(payrollRuns.tenantId, ctx.tenantId)))
      .limit(1));
    const run = runRows[0];

    // Try to load custom template from payroll.payroll_slip_templates
    let template = DEFAULT_TEMPLATE;
    try {
      const { sqlClient } = await import("../../shared/db.js");
      const tplRows = await sqlClient`
        SELECT body FROM payroll.payroll_slip_templates
        WHERE tenant_id = ${ctx.tenantId} AND status = 'active'
        ORDER BY created_at DESC LIMIT 1
      `;
      const first = tplRows[0] as { body?: string } | undefined;
      if (first?.body) {
        template = first.body;
      }
    } catch {
      // Table may not exist yet — use default template
    }

    // Hydrate employee identity fields from HRMS.
    // fetchPayrollInput returns full employee records (name, PAN, bank, UAN)
    // for the run month. If HRMS is unavailable we fall back to empty strings
    // so the PDF still renders — a warning is logged for ops visibility.
    let employeeName = "";
    let pan = "";
    let bankAccount = "";
    let bankIfsc = "";
    let uan = "";
    let department = "";

    if (run?.month) {
      try {
        const hrmsInput = await fetchPayrollInput(ctx.tenantId, run.month);
        const emp = hrmsInput.employees.find((e) => e.id === slip.employeeId);
        if (emp) {
          employeeName = emp.fullName;
          pan = emp.pan ?? "";
          bankAccount = emp.bankAccountNo ?? "";
          bankIfsc = emp.bankIfsc ?? "";
          uan = emp.uan ?? "";
        } else {
          req.log.warn({ employeeId: slip.employeeId, month: run.month },
            "payslip-pdf: employee not found in HRMS payroll-input for month");
        }
      } catch (err) {
        if (err instanceof HrmsUnavailableError) {
          req.log.warn({ err: err.message, employeeId: slip.employeeId },
            "payslip-pdf: HRMS unavailable — identity fields will be blank in PDF");
        } else {
          req.log.warn({ err, employeeId: slip.employeeId },
            "payslip-pdf: unexpected error fetching HRMS payroll-input");
        }
      }
    }

    // fetchEmployeeSummaries provides departmentName; it never throws (returns
    // empty Map on any failure) so no try/catch needed here.
    const summaries = await fetchEmployeeSummaries(ctx.tenantId);
    const summary = summaries.get(slip.employeeId);
    if (summary) {
      department = summary.departmentName;
      // Prefer the richer fullName from fetchPayrollInput if already set.
      if (!employeeName) employeeName = summary.fullName;
    }

    // Build components breakdown
    const components = slip.components ?? [];
    const earnings = components.filter((c) => c.type === "earning");
    const deductions = components.filter((c) => c.type === "deduction");

    const earningsRows = earnings
      .map((e) => `<tr><td>${e.name}</td><td class="amount">${formatAmount(e.amountMinor)}</td></tr>`)
      .join("\n    ");
    const deductionsRows = deductions
      .map((d) => `<tr><td>${d.name}</td><td class="amount">${formatAmount(d.amountMinor)}</td></tr>`)
      .join("\n    ");

    const pensionRows: string[] = [];
    if (slip.gpfMinor > 0n) {
      pensionRows.push(`<tr><td>GPF (10% of Basic)</td><td class="amount">${formatAmount(slip.gpfMinor)}</td></tr>`);
    }
    if (slip.npsEmployeeMinor > 0n) {
      pensionRows.push(`<tr><td>NPS (Employee 10%)</td><td class="amount">${formatAmount(slip.npsEmployeeMinor)}</td></tr>`);
    }
    if (slip.npsEmployerMinor > 0n) {
      pensionRows.push(`<tr><td>NPS (Employer 14%)</td><td class="amount">${formatAmount(slip.npsEmployerMinor)}</td></tr>`);
    }
    if (pensionRows.length === 0) {
      if (slip.pfEmployeeMinor > 0n) {
        pensionRows.push(`<tr><td>PF (Employee)</td><td class="amount">${formatAmount(slip.pfEmployeeMinor)}</td></tr>`);
      }
      if (slip.pfEmployerMinor > 0n) {
        pensionRows.push(`<tr><td>PF (Employer)</td><td class="amount">${formatAmount(slip.pfEmployerMinor)}</td></tr>`);
      }
      if (slip.esiMinor > 0n) {
        pensionRows.push(`<tr><td>ESI (Employee)</td><td class="amount">${formatAmount(slip.esiMinor)}</td></tr>`);
      }
    }

    const vars: Record<string, string> = {
      orgName: "Organization", // Would be fetched from tenant config in production
      month: run?.month ?? "",
      employeeNo: slip.employeeNo,
      employeeName,
      department,
      designation: "",
      uan,
      pan,
      bankAccount,
      bankIfsc,
      earningsRows,
      deductionsRows,
      pensionRows: pensionRows.join("\n    "),
      grossPay: formatAmount(slip.grossMinor),
      totalDeductions: formatAmount(slip.totalDeductionsMinor),
      netPay: formatAmount(slip.netPayMinor),
    };

    const html = renderTemplate(template, vars);
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .send(html);
  });
}
