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
import { putObject, presignedGetUrl } from "@civitasone/storage";
import { pino } from "pino";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { applyPdfWatermark, applyCsvWatermark } from "../../shared/watermark.js";
import { maskPiiColumns } from "../../shared/mask.js";

const AUDIT_TOPIC = "audit.event.record";

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
  /** Column keys containing PII to mask */
  piiColumns?: string[];
  /** Roles allowed to see unmasked PII */
  piiAllowedRoles?: string[];
  /** The executing user's role */
  actorRole?: string;
}

export function registerRenderConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  queue.subscribe<RenderPayload>(COMMANDS.renderJob, async (msg) => {
    const p = msg.payload;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Mark job as running
        await tx.update(jobs)
          .set({ status: "running", updatedAt: new Date(), updatedBy: msg.actorId })
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

      // Apply PII masking before rendering if configured
      let rows = p.rows ?? [];
      if (p.piiColumns && p.piiColumns.length > 0 && p.actorRole) {
        rows = maskPiiColumns(
          rows,
          p.piiColumns,
          p.actorRole,
          p.piiAllowedRoles ?? ["super_admin"],
        );
      }

      let buffer: Buffer;
      let contentType: string;
      let ext: string;

      switch (p.format) {
        case "pdf": {
          const result = await renderPdf({ html: p.templateHtml });
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
          buffer = Buffer.from(p.templateHtml, "utf-8");
          contentType = "text/html";
          ext = "html";
          break;
        }
      }

      // Upload to S3
      const key = `reports/${p.tenantId}/${p.jobId}.${ext}`;
      await putObject(key, buffer, contentType);
      const downloadUrl = await presignedGetUrl({ key, expiresIn: 86400 }); // 24h

      // Mark completed
      await db.transaction(async (tx) => {
        await tx.update(jobs)
          .set({
            status: "completed",
            downloadUrl,
            format: ext,
            rowCount: p.rows?.length ?? null,
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
          payload: { jobId: p.jobId, downloadUrl, format: ext, sizeBytes: buffer.length },
        });
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
