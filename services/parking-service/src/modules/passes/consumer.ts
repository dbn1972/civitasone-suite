import { pino } from "pino";
import { randomInt } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as facilitiesRepo from "../facilities/repo.js";
import { generatePassNumber, fromStatusesFor } from "./domain.js";

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
    // Mitigation, not a full fix — see bookings/consumer.ts for the same pattern.
    const passNumber = generatePassNumber("ULB", randomInt(1, 999999));
    const validFrom = new Date(p.validFrom);
    const validUntil = new Date(validFrom);
    if (p.passType === "annual") {
      validUntil.setFullYear(validUntil.getFullYear() + 1);
    } else {
      validUntil.setMonth(validUntil.getMonth() + 1);
    }
    // Was: hardcoded flat fee ("Placeholder fee; real implementation reads from
    // facility tariff" — the previous author's own comment). The facility's real
    // monthlyPassMinor/annualPassMinor are already stored and already exposed by
    // facilitiesRepo.findById; routes.ts now rejects the request with 422 before
    // publishing if the facility hasn't configured the relevant tariff, so by the
    // time this consumer runs it should always be present — but this is a
    // separate async execution context, so re-fetch and re-check rather than
    // trust the route's earlier read. amountMinor is NOT NULL on this table
    // (unlike bookings' nullable amountMinor), so if the tariff has since been
    // removed we fail closed and do not create a pass with a fabricated amount.
    const facility = await facilitiesRepo.findById(p.facilityId, msg.tenantId);
    const tariff = p.passType === "annual" ? facility?.annualPassMinor : facility?.monthlyPassMinor;
    if (tariff == null) {
      log.error({ id: p.id, facilityId: p.facilityId, passType: p.passType }, "facility has no tariff configured for this pass type; refusing to create pass with a fabricated amount");
      return;
    }
    const amountMinor = tariff;

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
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", fromStatusesFor("cancelled"), msg.actorId);
      if (!updated) return;
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
    if (updated) await cache.put(`parking:${msg.tenantId}:pass:${p.id}`, updated);
  });
}
