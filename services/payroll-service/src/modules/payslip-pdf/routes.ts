import { formatRupeesIN, minorFromDb } from "../../shared/money.js";
import { escapeHtml, renderTemplate } from "../../shared/html.js";
import { loadLetterhead } from "../letterhead/routes.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopeEmployeeId, staffRolesOf } from "../../shared/employee-scope.js";
import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { fetchPayrollInput, fetchEmployeeSummaries, fetchDefaultSlipTemplate, HrmsUnavailableError } from "../../shared/hrms-client.js";
import { maskLast4, maskPan } from "../../shared/pii-mask.js";
import { assertSlipPrintable, publishSlipDownloadAudit } from "./slip-gate.js";
import { resolveDocIdentity, PdfRendererUnavailableError } from "@civitasone/render/official";
import { renderPayslipPdf, type PayslipDocInput } from "./payslip-document.js";
import type { FastifyBaseLogger } from "fastify";

/** UAT ux-docs: no Chromium, no issuable PDF - 503, never an HTML file served as a PDF. */
async function pdfOr503<T>(render: () => Promise<T>): Promise<T> {
  try {
    return await render();
  } catch (err) {
    if (err instanceof PdfRendererUnavailableError) throw new HttpError(503, err.code, err.message);
    throw err;
  }
}


// UAT Phase 2 follow-up (security): a payslip PDF is per-employee pay data --
// payroll + HR staff see any slip; everyone else (an employee, including a
// finance officer who is also an employee) only their own. finance_officer is
// no longer a staff reader here (finance works from aggregate run totals).
const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "employee"];
const READER_STAFF_ROLES = staffRolesOf(READER_ROLES);

const pathParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * UAT ux-docs: /pdf and /download return a real PDF (application/pdf). The
 * tenant-template HTML print is still available with ?format=html (unchanged).
 * ?lang=hi prints Hindi-first labels and the net pay in Hindi words as well.
 */
export const slipDocQuerySchema = z.object({
  format: z.enum(["pdf", "html"]).default("pdf"),
  lang: z.enum(["en", "hi"]).default("en"),
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
  return formatRupeesIN(minorFromDb(minor));
}

// Intentionally flat: this only ever does {{var}} substitution, no
// Handlebars-style block helpers (#each/#if). There is no tenant-facing UI
// or API to author custom slip templates — payroll.payroll_slip_templates
// is populated exactly once, by a migration seed, and read-only from here
// on (see hrms-client.ts's fetchDefaultSlipTemplate). So any looping a
// template needs (earnings/deductions/pension rows) is pre-rendered to an
// HTML string by the caller below and passed in as a plain flat var —
// keep it that way rather than growing a template engine for one seed row.

/** Everything both outputs of a slip need, read once (ownership + print gate enforced here). */
export async function loadSlipDocument(ctx: ReturnType<typeof resolveContext>, id: string, log: FastifyBaseLogger) {
    // Fetch the salary slip
    const slipRows = await scopedRead((tx) => tx.select().from(payrollSlips)
      .where(and(eq(payrollSlips.id, id), eq(payrollSlips.tenantId, ctx.tenantId)))
      .limit(1));
    const slip = slipRows[0];
    if (!slip) throw new HttpError(404, "NOT_FOUND", "salary slip not found");

    // SEC-P1-01: a self-service `employee` caller may only download their OWN
    // payslip — without this, any employee could fetch any co-worker's slip
    // (gross/net/PAN/IFSC/UAN) by iterating slip ids.
    await scopeEmployeeId(ctx, slip.employeeId, READER_STAFF_ROLES);
    // Server-side print gate (after the ownership check, so a non-owner still
    // gets 403/404 rather than learning the slip's status).
    assertSlipPrintable(slip.status);

    // Fetch the run for month info
    const runRows = await scopedRead((tx) => tx.select().from(payrollRuns)
      .where(and(eq(payrollRuns.id, slip.runId), eq(payrollRuns.tenantId, ctx.tenantId)))
      .limit(1));
    const run = runRows[0];

    // Load the tenant's custom template from hrms-service, which owns
    // payroll.payroll_slip_templates (it physically lives in hrms-service's
    // own database, civitas_hrms — payroll-service has no DB-level access
    // to it; see hrms-client.ts's fetchDefaultSlipTemplate for why). Falls
    // back to DEFAULT_TEMPLATE both when the tenant has no template
    // configured (fetchDefaultSlipTemplate resolves null) and when
    // hrms-service is genuinely unreachable (HrmsUnavailableError) — a
    // missing payslip template should never block PDF generation.
    let template = DEFAULT_TEMPLATE;
    let footerText = "";
    try {
      const tpl = await fetchDefaultSlipTemplate(ctx.tenantId);
      if (tpl?.templateHtml) {
        template = tpl.templateHtml;
        footerText = tpl.footerText ?? "";
      }
    } catch (err) {
      if (err instanceof HrmsUnavailableError) {
        log.warn({ err: err.message, tenantId: ctx.tenantId },
          "payslip-pdf: HRMS unavailable — using default payslip template");
      } else {
        log.warn({ err, tenantId: ctx.tenantId },
          "payslip-pdf: unexpected error fetching payslip template — using default");
      }
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
    let designation = "";
    let payLevel: number | null = null;
    let payGrade: string | null = null;
    let rawPan: string | null = null;
    let rawBankAccount: string | null = null;

    if (run?.month) {
      try {
        const hrmsInput = await fetchPayrollInput(ctx.tenantId, run.month);
        const emp = hrmsInput.employees.find((e) => e.id === slip.employeeId);
        if (emp) {
          employeeName = emp.fullName;
          // PII: the payslip prints only the masked forms. The full bank
          // account number never belongs on a payslip (last 4 identifies the
          // credit account), and no statute requires the full PAN on a
          // salary slip (Form 16 is the PAN-bearing document), so PAN uses
          // the repo's standard ABCDE****F mask (web Masked.tsx maskPan).
          pan = maskPan(emp.pan);
          bankAccount = maskLast4(emp.bankAccountNo);
          bankIfsc = emp.bankIfsc ?? "";
          uan = emp.uan ?? "";
          rawPan = emp.pan ?? null;
          rawBankAccount = emp.bankAccountNo ?? null;
          // Additive HRMS fields (UAT ux-docs); absent from an older HRMS.
          const extra = emp as { designation?: unknown; payLevel?: unknown; payGrade?: unknown };
          designation = typeof extra.designation === "string" ? extra.designation : "";
          payLevel = typeof extra.payLevel === "number" && extra.payLevel > 0 ? extra.payLevel : null;
          payGrade = typeof extra.payGrade === "string" && extra.payGrade ? extra.payGrade : null;
        } else {
          log.warn({ employeeId: slip.employeeId, month: run.month },
            "payslip-pdf: employee not found in HRMS payroll-input for month");
        }
      } catch (err) {
        if (err instanceof HrmsUnavailableError) {
          log.warn({ err: err.message, employeeId: slip.employeeId },
            "payslip-pdf: HRMS unavailable — identity fields will be blank in PDF");
        } else {
          log.warn({ err, employeeId: slip.employeeId },
            "payslip-pdf: unexpected error fetching HRMS payroll-input");
        }
      }
    }

    // fetchEmployeeSummaries provides departmentName; it never throws (returns
    // empty Map on any failure) so no try/catch needed here.
    const summaries = await fetchEmployeeSummaries(ctx.tenantId, [slip.employeeId]);
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
      .map((e) => `<tr><td>${escapeHtml(e.name)}</td><td class="amount">${formatAmount(e.amountMinor)}</td></tr>`)
      .join("\n    ");
    const deductionsRows = deductions
      .map((d) => `<tr><td>${escapeHtml(d.name)}</td><td class="amount">${formatAmount(d.amountMinor)}</td></tr>`)
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

    const letterhead = await loadLetterhead(ctx.tenantId);
    const vars: Record<string, string> = {
      // GAP-PAYROLL-SALARY-SLIPS-DETAIL-02: the tenant's own issuing organisation
      // (HTML-escaped: an admin-entered string) -- never a platform default.
      orgName: letterhead?.orgName ?? "",
      month: run?.month ?? "",
      employeeNo: slip.employeeNo,
      employeeName,
      department,
      designation,
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
      footerText,
    };

    const docInput: Omit<PayslipDocInput, "lang"> = {
      issuer: { orgName: letterhead?.orgName ?? null, department: letterhead?.department ?? null, address: letterhead?.address ?? null },
      ddoName: letterhead?.ddoName ?? null,
      ddoCode: letterhead?.ddoCode ?? null,
      signatoryTitle: letterhead?.signatoryTitle ?? null,
      showSignatureBlock: letterhead?.showSignatureBlock ?? false,
      month: run?.month ?? "",
      employee: {
        employeeNo: slip.employeeNo, name: employeeName, designation: designation || null, payLevel, payGrade,
        department: department || null, pan: rawPan, uan: uan || null, bankAccount: rawBankAccount, bankIfsc: bankIfsc || null,
      },
      slip: {
        components: slip.components ?? [], grossMinor: BigInt(slip.grossMinor), totalDeductionsMinor: BigInt(slip.totalDeductionsMinor),
        netPayMinor: BigInt(slip.netPayMinor), pfEmployeeMinor: BigInt(slip.pfEmployeeMinor), pfEmployerMinor: BigInt(slip.pfEmployerMinor),
        gpfMinor: BigInt(slip.gpfMinor), npsEmployeeMinor: BigInt(slip.npsEmployeeMinor), npsEmployerMinor: BigInt(slip.npsEmployerMinor),
        esiMinor: BigInt(slip.esiMinor), tdsMinor: BigInt(slip.tdsMinor),
      },
    };
    return { slip, run, template, vars, docInput };
}

/** The issuable PDF of a loaded slip: the tenant document identity adds ministry and Hindi name. */
export async function slipPdfBytes(tenantId: string, docInput: Omit<PayslipDocInput, "lang">, lang: "en" | "hi"): Promise<Buffer> {
  const ident = await resolveDocIdentity(tenantId);
  const issuer = {
    ...docInput.issuer,
    orgName: docInput.issuer.orgName || ident.orgName,
    orgNameHi: ident.orgNameHi,
    ministry: ident.ministry,
    department: docInput.issuer.department || ident.department,
    address: docInput.issuer.address || ident.address,
  };
  return Buffer.from(await renderPayslipPdf({ ...docInput, issuer, lang }));
}

export function renderSlipHtml(template: string, vars: Record<string, string>): string {
  return renderTemplate(template, vars, ["earningsRows", "deductionsRows", "pensionRows"]);
}

export async function payslipPdfRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/slips/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = pathParamSchema.parse(req.params);
    const q = slipDocQuerySchema.parse(req.query ?? {});
    const { slip, run, template, vars, docInput } = await loadSlipDocument(ctx, id, req.log);
    if (q.format === "html") {
      const html = renderSlipHtml(template, vars);
      await publishSlipDownloadAudit(ctx, slip.id, "pdf");
      return reply
        .header("content-type", "text/html; charset=utf-8")
        .send(html);
    }
    const pdf = await pdfOr503(() => slipPdfBytes(ctx.tenantId, docInput, q.lang));
    await publishSlipDownloadAudit(ctx, slip.id, "pdf");
    const fname = `salary-slip-${slip.employeeNo}-${run?.month ?? "period"}.pdf`.replace(/[^\w.-]+/g, "_");
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="${fname}"`)
      .send(pdf);
  });
}
