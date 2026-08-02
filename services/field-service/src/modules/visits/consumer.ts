import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "field.visits.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerVisitConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.visitCheckIn, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      taskId: string;
      latitude: number;
      longitude: number;
      checkInAt: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        taskId: p.taskId,
        agentId: msg.actorId,
        checkInLatitude: p.latitude.toString(),
        checkInLongitude: p.longitude.toString(),
        checkInAt: new Date(p.checkInAt),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.visitCheckedIn,
        eventType: EVENTS.visitCheckedIn,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { visitId: p.id, taskId: p.taskId, latitude: p.latitude, longitude: p.longitude },
      });
      await writeAudit(tx, ctxOf(msg), { action: "visit.check_in", resourceType: "field_visit", resourceId: p.id });
    });
    log.info({ id: p.id }, "visit checked in");
  });

  queue.subscribe(COMMANDS.visitCheckOut, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      taskId: string;
      checkOutAt: string;
      latitude: number | null;
      longitude: number | null;
      notes: string | null;
      photos: string[];
      durationMinutes: number;
      outcome: string;
      version: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(
        tx,
        p.id,
        msg.tenantId,
        {
          checkOutAt: new Date(p.checkOutAt),
          checkOutLatitude: p.latitude?.toString() ?? null,
          checkOutLongitude: p.longitude?.toString() ?? null,
          durationMinutes: p.durationMinutes,
          outcome: p.outcome,
          notes: p.notes,
          photos: p.photos,
          updatedBy: msg.actorId,
        },
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.visitCheckedOut,
        eventType: EVENTS.visitCheckedOut,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { visitId: p.id, taskId: p.taskId, durationMinutes: p.durationMinutes, outcome: p.outcome },
      });
      await writeAudit(tx, ctxOf(msg), { action: "visit.check_out", resourceType: "field_visit", resourceId: p.id });
    });
  });
}
