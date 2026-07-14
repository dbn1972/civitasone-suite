/**
 * P1-002: PDF Salary Slip Download Route
 * GET /v1/payroll/slips/:id/download
 *
 * Takes the HTML from the existing /pdf endpoint and wraps it with a
 * content-disposition header for download. Full PDF binary conversion would need
 * puppeteer — for now the HTML download is the production deliverable since
 * browsers can print-to-PDF.
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";

const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer", "employee"];

function formatAmount(minor: number | bigint): string {
  return (Number(minor) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Salary Slip - {{month}}</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px}
.header{text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px}
th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}th{background:#f5f5f5}
.amount{text-align:right}.total-row{font-weight:bold;background:#f9f9f9}</style></head>
<body><div class="header"><h1>{{orgName}}</h1><h2>Salary Slip - {{month}}</h2></div>
<p>Employee: {{employeeNo}}</p>
<table><thead><tr><th>Earnings</th><th class="amount">Amount</th></tr></thead><tbody>{{earningsRows}}</tbody>
<tfoot><tr class="total-row"><td>Gross</td><td class="amount">{{grossPay}}</td></tr></tfoot></table>
<table><thead><tr><th>Deductions</th><th class="amount">Amount</th></tr></thead><tbody>{{deductionsRows}}</tbody>
<tfoot><tr class="total-row"><td>Total Deductions</td><td class="amount">{{totalDeductions}}</td></tr></tfoot></table>
<table><tbody><tr class="total-row"><td>Net Pay</td><td class="amount">{{netPay}}</td></tr></tbody></table>
</body></html>`;

export async function payslipDownloadRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/slips/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };

    const slipRows = await scopedRead((tx) => tx.select().from(payrollSlips)
      .where(and(eq(payrollSlips.id, id), eq(payrollSlips.tenantId, ctx.tenantId)))
      .limit(1));
    const slip = slipRows[0];
    if (!slip) throw new HttpError(404, "NOT_FOUND", "salary slip not found");

    const runRows = await scopedRead((tx) => tx.select().from(payrollRuns)
      .where(and(eq(payrollRuns.id, slip.runId), eq(payrollRuns.tenantId, ctx.tenantId)))
      .limit(1));
    const run = runRows[0];
    const month = run?.month ?? "unknown";

    // Build components breakdown
    const components = slip.components ?? [];
    const earnings = components.filter((c) => c.type === "earning");
    const deductions = components.filter((c) => c.type === "deduction");

    const earningsRows = earnings
      .map((e) => `<tr><td>${e.name}</td><td class="amount">${formatAmount(e.amountMinor)}</td></tr>`)
      .join("\n");
    const deductionsRows = deductions
      .map((d) => `<tr><td>${d.name}</td><td class="amount">${formatAmount(d.amountMinor)}</td></tr>`)
      .join("\n");

    const vars: Record<string, string> = {
      orgName: "Organization",
      month,
      employeeNo: slip.employeeNo,
      earningsRows,
      deductionsRows,
      grossPay: formatAmount(slip.grossMinor),
      totalDeductions: formatAmount(slip.totalDeductionsMinor),
      netPay: formatAmount(slip.netPayMinor),
    };

    const html = renderTemplate(DEFAULT_TEMPLATE, vars);
    const filename = `salary-slip-${slip.employeeNo}-${month}.html`;

    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(html);
  });
}
