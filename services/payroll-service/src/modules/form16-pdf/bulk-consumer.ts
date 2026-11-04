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
import { renderForm16Html, resolveForm16Deductor } from "./form16-document.js";
import type { Queue } from "@civitasone/queue";
import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
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
import { FORM16_RUN_LEVEL_EMPLOYEE_NO, type Form16FailureCode, type Form16FailureRecord } from "./failure-reasons.js";
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
    const rows = await scopedRead((tx) => tx
      .selectDistinct({ employeeId: payrollSlips.employeeId, employeeNo: payrollSlips.employeeNo })
      .from(payrollSlips)
      .innerJoin(payrollRuns, eq(payrollSlips.runId, payrollRuns.id))
      .where(
        and(
          eq(payrollSlips.tenantId, tenantId),
          inArray(payrollSlips.employeeId, employeeIds),
          eq(payrollRuns.status, "disbursed"),
        ),
      ));
    return rows;
  }

  // null → all employees with disbursed (finalised) slips in runs for this tenant
  const rows = await scopedRead((tx) => tx
    .selectDistinct({ employeeId: payrollSlips.employeeId, employeeNo: payrollSlips.employeeNo })
    .from(payrollSlips)
    .innerJoin(payrollRuns, eq(payrollSlips.runId, payrollRuns.id))
    .where(
      and(
        eq(payrollSlips.tenantId, tenantId),
        eq(payrollRuns.status, "disbursed"),
      ),
    ));
  return rows;
}

export function registerForm16BulkConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.form16BulkGenerate, async (msg) => {
    const p = msg.payload as BulkGeneratePayload;
    const { jobId, tenantId, fy, employeeIds } = p;

    // The job row and idempotency marker commit together. A redelivery cannot
    // create a second job or start a duplicate generation run.
    const initialized = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      await tx.insert(form16BulkJobs).values({
        id: jobId,
        tenantId,
        fy,
        status: "pending",
        createdBy: msg.actorId,
      }).onConflictDoNothing();
      return true;
    });
    if (!initialized) return;

    const storagePrefix = `form16/${tenantId}/${fy}`;
    const errorDetails: Form16FailureRecord[] = [];

    try {
      // 1. Resolve employee list
      const employees = await resolveEmployeeList(tenantId, fy, employeeIds);

      // Update total count on job
      await db.transaction(async (tx) => {
        await tx
          .update(form16BulkJobs)
          .set({ totalEmployees: employees.length, status: "processing", storagePrefix })
          .where(eq(form16BulkJobs.id, jobId));
      });

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
        // The stage in flight when something throws is the failure reason. It is
        // a closed code (see failure-reasons.ts), so what operators see in the UI
        // never depends on, or echoes, the exception text.
        let reasonCode: Form16FailureCode = "DATA_UNAVAILABLE";
        try {
          // a. Build Form 16 data
          const form16Data = await buildForm16(tenantId, emp.employeeId, fy);
          // UAT ux-docs: no Form 16 is issued without a configured deductor (a data gap, not a render error).
          const deductor = await resolveForm16Deductor(tenantId, form16Data.form16PartA.deductor);
          reasonCode = "UNKNOWN";
          const html = renderForm16Html(form16Data, deductor);

          // b. Render HTML → PDF
          reasonCode = "RENDERER_UNAVAILABLE";
          const pdfResult = await renderPdf({ html, format: "A4" });
          if (pdfResult.mode === "html-only") {
            throw new Error("PDF renderer unavailable (Chromium not found)");
          }

          let pdfBuffer = pdfResult.buffer;

          // c. Sign PDF if DSC available
          if (dscMaterial) {
            reasonCode = "SIGNING_FAILED";
            const signResult = await signPdfWithDsc(pdfBuffer, {
              p12Buffer: dscMaterial.p12Buffer,
              passphrase: dscMaterial.passphrase,
            });
            pdfBuffer = signResult.buffer;
          }

          // d. Upload to S3
          reasonCode = "STORAGE_ERROR";
          const s3Key = `${storagePrefix}/${emp.employeeNo}.pdf`;
          await putObject(s3Key, pdfBuffer, "application/pdf");

          generated++;
        } catch (err) {
          failed++;
          // `error` is operator-only (job row + log); bulk-status never returns it.
          const errMsg = err instanceof Error ? err.message : String(err);
          errorDetails.push({ employeeId: emp.employeeId, employeeNo: emp.employeeNo, error: errMsg, reasonCode });
          log.warn({ employeeId: emp.employeeId, jobId, reasonCode, error: errMsg }, "form16 bulk: employee PDF failed");
        }

        // Update progress after each employee
        await db.transaction(async (tx) => {
          await tx
            .update(form16BulkJobs)
            .set({ generated, failed, errorDetails: errorDetails.length > 0 ? errorDetails : null })
            .where(eq(form16BulkJobs.id, jobId));
        });
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
        await db.transaction(async (tx) => {
          await tx
            .update(form16BulkJobs)
            .set({
              status: "failed",
              errorDetails: [{ employeeId: "system", employeeNo: FORM16_RUN_LEVEL_EMPLOYEE_NO, error: errMsg, reasonCode: "UNKNOWN" }],
              completedAt: new Date(),
            })
            .where(eq(form16BulkJobs.id, jobId));
        });
      } catch {
        log.error({ jobId }, "failed to update job status after catastrophic error");
      }
    }
  });
}
