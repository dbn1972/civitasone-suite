import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "drainage.field_actions.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerFieldActionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.fieldActionCreate, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, complaintId: p.complaintId,
        actionType: p.actionType, performedBy: p.performedBy,
        drainAssetRef: p.drainAssetRef, notes: p.notes,
        beforePhoto: p.beforePhoto, afterPhoto: p.afterPhoto,
        durationMinutes: p.durationMinutes,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.fieldActionCreated, eventType: EVENTS.fieldActionCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fieldActionId: p.id, complaintId: p.complaintId, actionType: p.actionType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "field_action.create", resourceType: "drainage_field_action", resourceId: p.id });
    });
    log.info({ id: p.id }, "field action created");
  });
}
