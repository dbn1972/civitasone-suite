/**
 * Render consumer — processes report.job.render commands.
 * Calls @civitasone/render for real PDF/XLSX, uploads via @civitasone/storage,
 * updates job status + downloadUrl.
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

const log = pino({ name: "render-consumer" });

interface RenderPayload {
  jobId: string;
  tenantId: string;
  templateHtml: string;
  format: "pdf" | "xlsx" | "csv" | "html";
  columns?: Array<{ header: string; key: string; width?: number }>;
  rows?: Record<string, unknown>[];
  title?: string;
}

export function registerRenderConsumers(queue: Queue): void {
  queue.subscribe<RenderPayload>(COMMANDS.renderJob, async (msg) => {
    const p = msg.payload;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Mark job as running
        await tx.update(jobs)
          .set({ status: "running", updatedAt: new Date(), updatedBy: msg.actorId })
          .where(and(eq(jobs.id, p.jobId), eq(jobs.tenantId, p.tenantId)));
      });

      let buffer: Buffer;
      let contentType: string;
      let ext: string;

      switch (p.format) {
        case "pdf": {
          const result = await renderPdf({ html: p.templateHtml });
          buffer = result.buffer;
          contentType = "application/pdf";
          ext = "pdf";
          break;
        }
        case "xlsx": {
          const result = await renderXlsx({
            columns: (p.columns ?? []).map((c) => ({ header: c.header, key: c.key, width: c.width })),
            rows: p.rows ?? [],
            title: p.title,
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
            p.rows ?? [],
          );
          buffer = Buffer.from(csv, "utf-8");
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
      await db.update(jobs)
        .set({ status: "failed", updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(jobs.id, p.jobId), eq(jobs.tenantId, p.tenantId)));
      await cache.invalidate(cache.makeKey(p.tenantId, RESOURCE, p.jobId));
    }
  });
}
