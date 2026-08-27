import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "fire.inspections.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerInspectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.scheduleInspection, async (msg) => {
    const p = msg.payload as { id: string; applicationId: string; inspectorId: string; scheduledDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        inspectorId: p.inspectorId,
        scheduledDate: p.scheduledDate,
        status: "scheduled",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.inspectionScheduled,
        eventType: EVENTS.inspectionScheduled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { inspectionId: p.id, applicationId: p.applicationId, scheduledDate: p.scheduledDate },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.schedule", resourceType: "fire_inspection", resourceId: p.id });
    });
    log.info({ id: p.id, applicationId: p.applicationId }, "fire inspection scheduled");
  });

  queue.subscribe(COMMANDS.completeInspection, async (msg) => {
    const p = msg.payload as { inspectionId: string; recommendation: string; deficiencies?: unknown[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.inspectionId, "completed", {
        recommendation: p.recommendation,
        deficiencies: p.deficiencies ?? null,
        inspectedAt: new Date(),
      }, msg.actorId);
      if (!row) return;
      await enqueue(tx, {
        topic: EVENTS.inspectionCompleted,
        eventType: EVENTS.inspectionCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { inspectionId: p.inspectionId, recommendation: p.recommendation },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.complete", resourceType: "fire_inspection", resourceId: p.inspectionId });
    });
  });

  queue.subscribe(COMMANDS.recordFindings, async (msg) => {
    const p = msg.payload as { inspectionId: string; findings: unknown[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.inspectionId, "completed", {
        findings: p.findings,
        inspectedAt: new Date(),
      }, msg.actorId);
      if (!row) return;
      await enqueue(tx, {
        topic: EVENTS.findingsRecorded,
        eventType: EVENTS.findingsRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { inspectionId: p.inspectionId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.record_findings", resourceType: "fire_inspection", resourceId: p.inspectionId });
    });
  });
}
