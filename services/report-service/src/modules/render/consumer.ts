/**
 * Render consumer — processes report.job.render commands.
 * Calls @civitasone/render for real PDF/XLSX, uploads via @civitasone/storage,
 * updates job status + downloadUrl.
 *
 * Applies watermark and PII masking when configured on the template.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import { jobs } from "../jobs/schema.js";
import { eq, and } from "drizzle-orm";
import { renderPdf } from "@civitasone/render/pdf";
import { renderXlsx, renderCsv } from "@civitasone/render/xlsx";
import { putObject } from "@civitasone/storage";
import { pino } from "pino";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { applyPdfWatermark, applyCsvWatermark } from "../../shared/watermark.js";
import { maskAllPii } from "../../shared/mask.js";
import { jobStorageKey } from "../../shared/download.js";
import { withRenderSandbox } from "../../shared/report-html.js";

const AUDIT_TOPIC = "audit.event.record";

/** Max rows persisted for the job detail preview (the full data lives in the export file). */
export const RESULT_PREVIEW_ROWS = 200;

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return v instanceof Date ? v.toISOString() : JSON.stringify(v);
  return String(v);
}

/**
 * Bounded, string-only preview of the rendered rows for GET report-jobs/:id.
 * Built from the SAME rows that were rendered, i.e. AFTER PII masking.
 */
export function buildResultPreview(
  columns: Array<{ key: string }> | undefined,
  rows: Record<string, unknown>[],
): { resultColumns: string[]; resultRows: Array<Record<string, string>> } {
  const keys = columns && columns.length > 0 ? columns.map((c) => c.key) : rows[0] ? Object.keys(rows[0]) : [];
  const resultRows = rows.slice(0, RESULT_PREVIEW_ROWS).map((r) => {
    const out: Record<string, string> = {};
    for (const k of keys) out[k] = cellToString(r[k]);
    return out;
  });
  return { resultColumns: keys, resultRows };
}

const log = pino({ name: "render-consumer" });

interface RenderPayload {
  jobId: string;
  tenantId: string;
  templateHtml: string;
  format: "pdf" | "xlsx" | "csv" | "html";
  columns?: Array<{ header: string; key: string; width?: number }>;
  rows?: Record<string, unknown>[];
  title?: string;
  /** Watermark text to overlay on the export */
  watermark?: string;
  /** Column keys containing PII. Always masked unless `piiUnmask` is a valid grant. */
  piiColumns?: string[];
  /**
   * Owner decision #17: the ONLY way to export PII columns unmasked. Issued by the
   * job consumer for a report_admin's request; needs a reason and must name the
   * actor of this very command, so a payload cannot borrow someone else's grant.
   */
  piiUnmask?: { reason?: string; grantedBy?: string };
}

/** The reason of a valid unmask grant, else null (=> mask). */
function validUnmaskReason(grant: RenderPayload["piiUnmask"], actorId: string): string | null {
  const reason = grant?.reason?.trim();
  return reason && grant?.grantedBy === actorId ? reason : null;
}

export function registerRenderConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  queue.subscribe<RenderPayload>(COMMANDS.renderJob, async (msg) => {
    const p = msg.payload;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Mark job as in progress. jobs_status_check (migration 0008) allows
        // queued/processing/completed/failed only; writing 'running' violated it,
        // rolled this tx back and sent every job straight to 'failed' (UAT #62).
        await tx.update(jobs)
          .set({ status: "processing", updatedAt: new Date(), updatedBy: msg.actorId })
          .where(and(eq(jobs.id, p.jobId), eq(jobs.tenantId, p.tenantId)));
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "report-service",
            action: "process",
            resourceType: "render",
            resourceId: p.jobId,
            outcome: "success",
          },
        });
      });

      // Owner decision #17: PII columns are masked BY DEFAULT. Only an explicit grant
      // with a reason (see validUnmaskReason) skips masking, and it is audited below.
      let rows = p.rows ?? [];
      const piiColumns = p.piiColumns ?? [];
      const unmaskReason = piiColumns.length > 0 ? validUnmaskReason(p.piiUnmask, msg.actorId) : null;
      if (piiColumns.length > 0 && !unmaskReason) {
        rows = maskAllPii(rows, piiColumns);
      }

      let buffer: Buffer;
      let contentType: string;
      let ext: string;

      switch (p.format) {
        case "pdf": {
          // Defence in depth: no-network / no-script CSP on whatever HTML arrives
          // (the payload comes off the queue; producers also escape their values).
          const result = await renderPdf({ html: withRenderSandbox(p.templateHtml) });
          buffer = p.watermark
            ? applyPdfWatermark(result.buffer, { text: p.watermark })
            : result.buffer;
          contentType = "application/pdf";
          ext = "pdf";
          break;
        }
        case "xlsx": {
          const xlsxTitle = p.watermark
            ? `${p.watermark}\n${p.title ?? ""}`
            : p.title;
          const result = await renderXlsx({
            columns: (p.columns ?? []).map((c) => ({ header: c.header, key: c.key, width: c.width })),
            rows,
            title: xlsxTitle,
            generatedAt: new Date().toISOString(),
          });
          buffer = result.buffer;
          contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          ext = "xlsx";
          break;
        }
        case "csv": {
          const csv = renderCsv(
            (p.columns ?? []).map((c) => ({ header: c.header, key: c.key })),
            rows,
          );
          const csvContent = p.watermark ? applyCsvWatermark(csv, p.watermark) : csv;
          buffer = Buffer.from(csvContent, "utf-8");
          contentType = "text/csv";
          ext = "csv";
          break;
        }
        case "html":
        default: {
          buffer = Buffer.from(withRenderSandbox(p.templateHtml), "utf-8");
          contentType = "text/html";
          ext = "html";
          break;
        }
      }

      // Upload to S3
      // Owner decision #17: store the key, never a presigned bearer URL. The download
      // route mints a 15-minute link per (owner-checked, audited) fetch.
      const key = jobStorageKey(p.tenantId, p.jobId, ext);
      await putObject(key, buffer, contentType);

      // Mark completed
      await db.transaction(async (tx) => {
        await tx.update(jobs)
          .set({
            status: "completed",
            downloadUrl: key,
            format: ext,
            rowCount: p.rows?.length ?? null,
            ...buildResultPreview(p.columns, rows),
            completedAt: new Date(),
            updatedAt: new Date(),
            updatedBy: msg.actorId,
          })
          .where(and(eq(jobs.id, p.jobId), eq(jobs.tenantId, p.tenantId)));

        await enqueue(tx, {
          topic: EVENTS.jobCompleted,
          eventType: EVENTS.jobCompleted,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { jobId: p.jobId, format: ext, sizeBytes: buffer.length },
        });
        // Every export that touches PII columns is audited; an unmasked one carries
        // the reason and the actor. Counts only, never row values.
        if (piiColumns.length > 0) {
          await enqueue(tx, {
            topic: AUDIT_TOPIC,
            eventType: AUDIT_TOPIC,
            tenantId: p.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              service: "report-service",
              action: unmaskReason ? "export_unmasked" : "export",
              resourceType: "report_job",
              resourceId: p.jobId,
              outcome: "success",
              format: ext,
              piiColumnCount: piiColumns.length,
              piiMasked: !unmaskReason,
              ...(unmaskReason ? { unmaskReason, unmaskedBy: msg.actorId } : {}),
            },
          });
        }
      });

      await cache.invalidate(cache.makeKey(p.tenantId, RESOURCE, p.jobId));
      log.info({ jobId: p.jobId, format: ext, sizeBytes: buffer.length }, "report rendered + uploaded");
    } catch (err) {
      log.error({ err, jobId: p.jobId }, "render failed");
      // RLS (#146): a bare db.update() runs outside the GUC transaction and is
      // rejected under NOBYPASSRLS — mark-failed must also run inside a tx.
      await db.transaction((tx) =>
        tx.update(jobs)
          .set({ status: "failed", updatedAt: new Date(), updatedBy: msg.actorId })
          .where(and(eq(jobs.id, p.jobId), eq(jobs.tenantId, p.tenantId))),
      );
      await cache.invalidate(cache.makeKey(p.tenantId, RESOURCE, p.jobId));
    }
  });
}
