/**
 * inspection-service: reports module — command consumers.
 *
 * UAT FQ9 #23: POST /v1/inspection/reports published `inspection.report.create` (202) but nothing
 * subscribed, so every report was dropped (queue_publish_no_subscribers) and the table stayed empty.
 *
 * Follows the CivitasOne CQRS consumer contract: markProcessed (idempotency) → insert → audit via the
 * outbox, all in one transaction. (Report reads are not cached, so there is nothing to invalidate.)
 *
 * Only `inspection.report.create` is handled here. observation.add / submit / approve are still
 * published by the routes without a consumer (tracked separately, out of FQ9-B scope).
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { inspectionReports } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
export const REPORT_CREATE_TOPIC = "inspection.report.create";

export interface ReportCreatePayload {
  id: string;
  tenantId: string;
  inspectorId: string;
  inspectionId: string;
  entityId: string;
  reportType?: string | undefined;
  summary?: string | undefined;
  recommendations?: string | undefined;
  overallGrade?: string | undefined;
}

export function registerReportsConsumers(queue: Queue): void {
  queue.subscribe<ReportCreatePayload>(REPORT_CREATE_TOPIC, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.insert(inspectionReports).values({
        id: p.id,
        tenantId: msg.tenantId,
        inspectionId: p.inspectionId,
        entityId: p.entityId,
        inspectorId: p.inspectorId,
        reportType: p.reportType ?? "standard",
        status: "draft",
        summary: p.summary ?? null,
        recommendations: p.recommendations ?? null,
        overallGrade: p.overallGrade ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "inspection_report.created",
          resourceType: "inspection_report",
          resourceId: p.id,
          details: { inspectionId: p.inspectionId, entityId: p.entityId, reportType: p.reportType ?? "standard" },
        },
      });
    });
  });
}
