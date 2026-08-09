import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "crematorium.records.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerRecordConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.recordService, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      bookingId: string;
      facilityId: string;
      serviceDate: string;
      slotNumber?: string;
      serviceType: string;
      notes?: string;
      completionCertificateRef?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRecord(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        bookingId: p.bookingId,
        facilityId: p.facilityId,
        serviceDate: p.serviceDate,
        slotNumber: p.slotNumber ?? null,
        serviceType: p.serviceType,
        performedBy: msg.actorId,
        notes: p.notes ?? null,
        completionCertificateRef: p.completionCertificateRef ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.serviceRecorded,
        eventType: EVENTS.serviceRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { recordId: p.id, bookingId: p.bookingId, facilityId: p.facilityId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "record.create",
        resourceType: "crematorium_record",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, bookingId: p.bookingId }, "crematorium service recorded");
  });
}
