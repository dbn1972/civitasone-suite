import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateLicenceNumber, generateVerificationCode } from "./domain.js";

const log = pino({ name: "vendor.licences.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLicenceConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issueLicence, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      registrationId: string;
      zone: string;
      spotNumber: string;
      validFrom: string;
      validUntil: string;
    };
    const licenceNumber = generateLicenceNumber("ULB", Date.now() % 999999);
    const verificationCode = generateVerificationCode();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertLicence(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        licenceNumber,
        registrationId: p.registrationId,
        status: "active",
        issuedAt: new Date(),
        validFrom: new Date(p.validFrom),
        validUntil: new Date(p.validUntil),
        zone: p.zone,
        spotNumber: p.spotNumber,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.licenceIssued,
        eventType: EVENTS.licenceIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          licenceId: p.id,
          licenceNumber,
          registrationId: p.registrationId,
          zone: p.zone,
          spotNumber: p.spotNumber,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "licence.issue",
        resourceType: "vendor_licence",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, licenceNumber }, "vendor licence issued");
  });

  queue.subscribe(COMMANDS.suspendLicence, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateStatus(tx, p.id, msg.tenantId, "suspended", msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.licenceSuspended,
        eventType: EVENTS.licenceSuspended,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { licenceId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "licence.suspend",
        resourceType: "vendor_licence",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.cancelLicence, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.licenceCancelled,
        eventType: EVENTS.licenceCancelled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { licenceId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "licence.cancel",
        resourceType: "vendor_licence",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.recordLicenceFee, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; transactionId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: EVENTS.licenceFeeRecorded,
        eventType: EVENTS.licenceFeeRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { licenceId: p.id, transactionId: p.transactionId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "licence.record_fee",
        resourceType: "vendor_licence",
        resourceId: p.id,
      });
    });
  });
}
