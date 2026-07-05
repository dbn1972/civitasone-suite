/**
 * Bulk Form 16 PDF generation consumer.
 *
 * Subscribes to `payroll.form16.bulk_generate` command.
 * For each employee in the batch:
 *   1. buildForm16() → data
 *   2. Render HTML → PDF → sign (DSC loaded once, reused)
 *   3. Upload to S3: form16/{tenantId}/{fy}/{employeeNo}.pdf
 *   4. Update job progress (generated++ or failed++)
 * On completion: emit payroll.form16.bulk_completed + audit.
 * On per-employee error: record in error_details jsonb, continue with next.
 */
import type { Queue } from "@civitasone/queue";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { buildForm16 } from "../tax/form16.js";
import { renderPdf } from "@civitasone/render";
import { signPdfWithDsc } from "@civitasone/render";
import { loadDsc, type DscMaterial } from "../dsc-config/loader.js";
import { putObject } from "@civitasone/storage";
import { payrollSlips } from "../payroll/schema.js";
import { payrollRuns } from "../payroll/schema.js";
import { form16BulkJobs } from "./schema.js";
import { pino } from "pino";

const log = pino({ name: "form16-bulk-consumer" });
const AUDIT = "audit.event.record";

interface BulkGeneratePayload {
  jobId: string;
  tenantId: string;
  fy: string;
  employeeIds: string[] | null;
}

/**
 * Resolve the list of employees to generate Form 16 for.
 * If employeeIds is null, query all employees with finalised slips in the FY.
 */
async function resolveEmployeeList(
  tenantId: string,
  fy: string,
  employeeIds: string[] | null,
): Promise<Array<{ employeeId: string; employeeNo: string }>> {
  if (employeeIds && employeeIds.length > 0) {
    // Use provided list — still resolve employeeNo from slips
    const rows = await db
      .selectDistinct({ employeeId: payrollSlips.employeeId, employeeNo: payrollSlips.employeeNo })
      .from(payrollSlips)
      .innerJoin(payrollRuns, eq(payrollSlips.runId, payrollRuns.id))
      .where(
        and(
          eq(payrollSlips.tenantId, tenantId),
          inArray(payrollSlips.employeeId, employeeIds),
          eq(payrollRuns.status, "disbursed"),
        ),
      );
    return rows;
  }

  // null → all employees with disbursed (finalised) slips in runs for this tenant
  const rows = await db
    .selectDistinct({ employeeId: payrollSlips.employeeId, employeeNo: payrollSlips.employeeNo })
    .from(payrollSlips)
    .innerJoin(payrollRuns, eq(payrollSlips.runId, payrollRuns.id))
    .where(
      and(
        eq(payrollSlips.tenantId, tenantId),
        eq(payrollRuns.status, "disbursed"),
      ),
    );
  return rows;
}

/**
 * Render Form 16 HTML from template (same logic as routes.ts single-employee).
 * Duplicated here to avoid circular dependency — kept minimal.
 */
function renderForm16Html(f: Awaited<ReturnType<typeof buildForm16>>): string {
  const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const a = f.form16PartA, b = f.form16PartB;
  const row = (label: string, val: number, bold = false) =>
    `<tr><td>${bold ? `<strong>${label}</strong>` : label}</td><td class="amount">${bold ? `<strong>₹ ${inr(val)}</strong>` : `₹ ${inr(val)}`}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Form 16 — FY ${f.fy}</title>
<style>
body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:24px;font-size:13px}
h1{text-align:center;font-size:16px} h2{font-size:14px;margin-top:20px}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #333;padding:6px 8px} .amount{text-align:right}
.meta td{border:none;padding:2px 8px}
</style></head><body>
<h1>Form 16 — Certificate under Section 203 of the Income-tax Act, 1961</h1>
<table class="meta">
<tr><td><strong>Financial Year:</strong> ${f.fy}</td><td><strong>Assessment Year:</strong> ${f.assessmentYear}</td></tr>
</table>
<h2>Part A — Deductor &amp; Deductee, TDS Deposited</h2>
<table>
<tr><td>Deductor (Employer)</td><td>${a.deductor.name}</td></tr>
<tr><td>Deductor TAN</td><td>${a.deductor.tan}</td></tr>
<tr><td>Deductor PAN</td><td>${a.deductor.pan}</td></tr>
<tr><td>Employee (Deductee)</td><td>${a.deductee.name || f.employeeId}</td></tr>
<tr><td>Employee PAN</td><td>${a.deductee.pan || "—"}</td></tr>
</table>
<table>
<tr><th>Quarter</th><th class="amount">TDS Deposited</th></tr>
<tr><td>Q1 (Apr–Jun)</td><td class="amount">₹ ${inr(a.quarterlyTds.Q1)}</td></tr>
<tr><td>Q2 (Jul–Sep)</td><td class="amount">₹ ${inr(a.quarterlyTds.Q2)}</td></tr>
<tr><td>Q3 (Oct–Dec)</td><td class="amount">₹ ${inr(a.quarterlyTds.Q3)}</td></tr>
<tr><td>Q4 (Jan–Mar)</td><td class="amount">₹ ${inr(a.quarterlyTds.Q4)}</td></tr>
<tr><td><strong>Total</strong></td><td class="amount"><strong>₹ ${inr(a.totalTdsDeposited)}</strong></td></tr>
</table>
<h2>Part B — Details of Salary Paid and Tax Deducted (${b.regime} regime)</h2>
<table>
${row("Gross Salary", b.grossSalary)}
${row("Standard Deduction (Sec 16)", b.standardDeduction)}
${row("HRA Exemption (Sec 10(13A))", b.hraExempt)}
${row("Deduction 80C", b.section80c)}
${row("Deduction 80D", b.section80d)}
${row("Other Chapter VI-A", b.otherDeductions)}
${row("Total Taxable Income", b.taxableIncome, true)}
${row("Tax on Income", b.taxOnIncome)}
${row("Rebate u/s 87A", b.rebate87A)}
${row("Surcharge", b.surcharge)}
${row("Health &amp; Education Cess (4%)", b.cess)}
${row("Total Tax Liability", b.totalTaxLiability, true)}
${row("Total TDS Deducted", b.totalTdsDeducted, true)}
${b.balanceTaxPayable > 0 ? row("Balance Tax Payable", b.balanceTaxPayable, true) : row("Refund Due", b.refundDue, true)}
</table>
<p style="font-size:11px;color:#666;margin-top:24px">${a.note} Generated by CivitasOne ERP — verify against TRACES before filing.</p>
</body></html>`;
}

export function registerForm16BulkConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.form16BulkGenerate, async (msg) => {
    const p = msg.payload as BulkGeneratePayload;
    const { jobId, tenantId, fy, employeeIds } = p;

    // Idempotency check
    const idempotent = await db.transaction(async (tx) => {
      return markProcessed(tx, msg.messageId);
    });
    if (!idempotent) return;

    const storagePrefix = `form16/${tenantId}/${fy}`;
    const errorDetails: Array<{ employeeId: string; employeeNo: string; error: string }> = [];

    try {
      // 1. Resolve employee list
      const employees = await resolveEmployeeList(tenantId, fy, employeeIds);

      // Update total count on job
      await db
        .update(form16BulkJobs)
        .set({ totalEmployees: employees.length, status: "processing", storagePrefix })
        .where(eq(form16BulkJobs.id, jobId));

      if (employees.length === 0) {
        // Nothing to generate — mark complete immediately
        await db.transaction(async (tx) => {
          await tx
            .update(form16BulkJobs)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(form16BulkJobs.id, jobId));

          await enqueue(tx, {
            topic: EVENTS.form16BulkCompleted,
            eventType: EVENTS.form16BulkCompleted,
            tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: { jobId, fy, totalGenerated: 0, totalFailed: 0, storagePrefix },
          });
        });
        return;
      }

      // 2. Load DSC once (reuse across batch)
      const dscMaterial: DscMaterial | null = await loadDsc(tenantId);

      // 3. Process each employee serially (Playwright browser reused internally by renderPdf)
      let generated = 0;
      let failed = 0;

      for (const emp of employees) {
        try {
          // a. Build Form 16 data
          const form16Data = await buildForm16(tenantId, emp.employeeId, fy);
          const html = renderForm16Html(form16Data);

          // b. Render HTML → PDF
          const pdfResult = await renderPdf({ html, format: "A4" });
          if (pdfResult.mode === "html-only") {
            throw new Error("PDF renderer unavailable (Chromium not found)");
          }

          let pdfBuffer = pdfResult.buffer;

          // c. Sign PDF if DSC available
          if (dscMaterial) {
            const signResult = await signPdfWithDsc(pdfBuffer, {
              p12Buffer: dscMaterial.p12Buffer,
              passphrase: dscMaterial.passphrase,
            });
            pdfBuffer = signResult.buffer;
          }

          // d. Upload to S3
          const s3Key = `${storagePrefix}/${emp.employeeNo}.pdf`;
          await putObject(s3Key, pdfBuffer, "application/pdf");

          generated++;
        } catch (err) {
          failed++;
          const errMsg = err instanceof Error ? err.message : String(err);
          errorDetails.push({ employeeId: emp.employeeId, employeeNo: emp.employeeNo, error: errMsg });
          log.warn({ employeeId: emp.employeeId, jobId, error: errMsg }, "form16 bulk: employee PDF failed");
        }

        // Update progress after each employee
        await db
          .update(form16BulkJobs)
          .set({ generated, failed, errorDetails: errorDetails.length > 0 ? errorDetails : null })
          .where(eq(form16BulkJobs.id, jobId));
      }

      // 4. Mark job complete + emit event + audit
      await db.transaction(async (tx) => {
        await tx
          .update(form16BulkJobs)
          .set({
            status: "completed",
            generated,
            failed,
            errorDetails: errorDetails.length > 0 ? errorDetails : null,
            completedAt: new Date(),
          })
          .where(eq(form16BulkJobs.id, jobId));

        await enqueue(tx, {
          topic: EVENTS.form16BulkCompleted,
          eventType: EVENTS.form16BulkCompleted,
          tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { jobId, fy, totalGenerated: generated, totalFailed: failed, storagePrefix },
        });

        await enqueue(tx, {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "payroll",
            action: "form16_bulk_completed",
            resourceType: "form16_bulk_job",
            resourceId: jobId,
            outcome: "success",
            detail: { fy, totalGenerated: generated, totalFailed: failed },
          },
        });
      });

      log.info({ jobId, fy, generated, failed }, "form16 bulk generation completed");
    } catch (err) {
      // Catastrophic failure (e.g., DB down) — mark job failed
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ jobId, error: errMsg }, "form16 bulk generation failed catastrophically");

      try {
        await db
          .update(form16BulkJobs)
          .set({
            status: "failed",
            errorDetails: [{ employeeId: "system", employeeNo: "N/A", error: errMsg }],
            completedAt: new Date(),
          })
          .where(eq(form16BulkJobs.id, jobId));
      } catch {
        log.error({ jobId }, "failed to update job status after catastrophic error");
      }
    }
  });
}
