import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "roadcut.inspections.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerInspectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.scheduleInspection, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      permitId: string;
      inspectionType: string;
      inspectorId: string;
      scheduledDate: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertInspection(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitId: p.permitId,
        inspectionType: p.inspectionType,
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
        payload: {
          inspectionId: p.id,
          permitId: p.permitId,
          inspectionType: p.inspectionType,
          scheduledDate: p.scheduledDate,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "inspection.schedule",
        resourceType: "roadcut_inspection",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, permitId: p.permitId }, "inspection scheduled");
  });

  queue.subscribe(COMMANDS.completeInspection, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      status: string;
      findings: Record<string, unknown>;
      photos?: Array<{ fileId: string; caption?: string }>;
      restorationQuality?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.completeInspection(
        tx, p.id, msg.tenantId, p.status, p.findings,
        p.photos ?? null, p.restorationQuality ?? null, msg.actorId,
      );
      await enqueue(tx, {
        topic: EVENTS.inspectionCompleted,
        eventType: EVENTS.inspectionCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          inspectionId: p.id,
          status: p.status,
          restorationQuality: p.restorationQuality,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "inspection.complete",
        resourceType: "roadcut_inspection",
        resourceId: p.id,
      });
    });
  });
}
