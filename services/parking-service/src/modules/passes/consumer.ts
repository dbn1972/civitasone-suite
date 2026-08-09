import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generatePassNumber } from "./domain.js";

const log = pino({ name: "parking.passes.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPassConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createPass, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      facilityId: string;
      holderName: string;
      vehicleNumber: string;
      vehicleType: string;
      passType: string;
      validFrom: string;
      paymentRef?: string;
    };
    const passNumber = generatePassNumber("ULB", Date.now() % 999999);
    const validFrom = new Date(p.validFrom);
    const validUntil = new Date(validFrom);
    if (p.passType === "annual") {
      validUntil.setFullYear(validUntil.getFullYear() + 1);
    } else {
      validUntil.setMonth(validUntil.getMonth() + 1);
    }
    // Placeholder fee; real implementation reads from facility tariff
    const amountMinor = p.passType === "annual" ? 600000n : 60000n;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPass(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        passNumber,
        facilityId: p.facilityId,
        holderName: p.holderName,
        vehicleNumber: p.vehicleNumber,
        vehicleType: p.vehicleType,
        passType: p.passType,
        validFrom: p.validFrom,
        validUntil: validUntil.toISOString().slice(0, 10),
        amountMinor,
        currency: "INR",
        status: "active",
        paymentRef: p.paymentRef ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.passCreated,
        eventType: EVENTS.passCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { passId: p.id, passNumber, vehicleNumber: p.vehicleNumber },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "pass.create",
        resourceType: "parking_pass",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, passNumber }, "parking pass created");
  });

  queue.subscribe(COMMANDS.cancelPass, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.passCancelled,
        eventType: EVENTS.passCancelled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { passId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "pass.cancel",
        resourceType: "parking_pass",
        resourceId: p.id,
      });
    });
  });
}
