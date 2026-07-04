/**
 * Render consumer — processes report.job.render commands.
 * Calls the render engine, uploads to S3, updates job status + downloadUrl.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import { jobs } from "../jobs/schema.js";
import { eq, and } from "drizzle-orm";
import { render } from "./engine.js";

const log = pino({ name: "render-consumer" });

interface RenderPayload {
  jobId: string;
  tenantId: string;
  templateKey: string;
  format: "pdf" | "xlsx" | "csv" | "html";
  data: Record<string, unknown>;
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

      // Render (outside transaction — may be slow for large reports)
      const result = await render({
        jobId: p.jobId,
        tenantId: p.tenantId,
        templateKey: p.templateKey,
        format: p.format,
        data: p.data,
      });

      // Mark completed with downloadUrl
      await db.transaction(async (tx) => {
        await tx.update(jobs)
          .set({
            status: "completed",
            downloadUrl: result.downloadUrl,
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
          payload: { jobId: p.jobId, downloadUrl: result.downloadUrl, durationMs: result.durationMs },
        });
      });

      await cache.invalidate(cache.makeKey(p.tenantId, RESOURCE, p.jobId));
      log.info({ jobId: p.jobId, durationMs: result.durationMs }, "report rendered");
    } catch (err) {
      log.error({ err, jobId: p.jobId }, "render failed");

      // Mark failed
      await db.update(jobs)
        .set({ status: "failed", updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(jobs.id, p.jobId), eq(jobs.tenantId, p.tenantId)));

      await cache.invalidate(cache.makeKey(p.tenantId, RESOURCE, p.jobId));
    }
  });
}
