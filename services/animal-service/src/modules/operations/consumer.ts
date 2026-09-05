import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "animal.operations.consumer" });

// Wave 3 cross-service events (see ../../shared/cross-events.ts): this
// consumer is deliberately NOT wired. recordOperation is a field-operations
// log (capture/sterilize/vaccinate/relocate/shelter/carcass_removal/
// treatment performed on an animal) with no citizen contact captured
// anywhere on animal_operations -- only performedBy (the staff member) and
// complaintId. Any citizen-facing notification for the underlying
// complaint is already emitted from complaints/consumer.ts's
// markActionTaken/closeComplaint. This mirrors sewerage-service's
// fieldRecordCreate, which applied the identical reasoning.

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerOperationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.recordOperation, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      complaintId: string;
      operationType: string;
      performedAt: string;
      animalTagId?: string;
      location?: Record<string, unknown>;
      notes?: string;
      beforePhoto?: string;
      afterPhoto?: string;
      shelterRef?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertOperation(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        complaintId: p.complaintId,
        operationType: p.operationType,
        performedBy: msg.actorId,
        performedAt: new Date(p.performedAt),
        animalTagId: p.animalTagId ?? null,
        location: (p.location as never) ?? null,
        notes: p.notes ?? null,
        beforePhoto: p.beforePhoto ?? null,
        afterPhoto: p.afterPhoto ?? null,
        shelterRef: p.shelterRef ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.operationRecorded,
        eventType: EVENTS.operationRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { operationId: p.id, complaintId: p.complaintId, operationType: p.operationType },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "operation.record",
        resourceType: "animal_operation",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, complaintId: p.complaintId }, "animal operation recorded");
  });
}
