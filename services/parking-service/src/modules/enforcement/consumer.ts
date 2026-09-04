import { pino } from "pino";
import { randomInt } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateViolationNumber, calculateFineMinor, fromStatusesFor } from "./domain.js";

const log = pino({ name: "parking.enforcement.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerEnforcementConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issueViolation, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      location?: Record<string, unknown>;
      vehicleNumber: string;
      violationType: string;
      photo?: string;
      challanRef?: string;
    };
    // Mitigation, not a full fix — see bookings/consumer.ts for the same pattern.
    const violationNumber = generateViolationNumber("ULB", randomInt(1, 999999));
    const fineMinor = calculateFineMinor(p.violationType);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertViolation(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        violationNumber,
        location: (p.location as never) ?? null,
        vehicleNumber: p.vehicleNumber,
        violationType: p.violationType,
        photo: p.photo ?? null,
        fineMinor,
        currency: "INR",
        status: "issued",
        issuedBy: msg.actorId,
        challanRef: p.challanRef ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.violationIssued,
        eventType: EVENTS.violationIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { violationId: p.id, violationNumber, vehicleNumber: p.vehicleNumber, fineMinor: String(fineMinor) },
      });
      // The fine is due the moment it's assessed — calculateFineMinor gives a
      // real nonzero amount immediately at issuance (unlike the booking-fee
      // path, there's no later transition that first learns the amount), so
      // the challan is raised atomically with the violation row itself.
      // There's no owner/citizen id on this schema (only vehicleNumber; the
      // actor here is the issuing officer, not the citizen), so recipientId
      // is intentionally omitted from the paired notification below.
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: violationNumber,
        depositor: p.vehicleNumber,
        amountMinor: fineMinor,
      });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: p.vehicleNumber,
        variables: { violationId: p.id, violationNumber, status: "issued", fineMinor: String(fineMinor) },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "violation.issue",
        resourceType: "parking_violation",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, violationNumber }, "parking violation issued");
  });

  queue.subscribe(COMMANDS.payViolation, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; paymentRef: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const updated = await repo.updateStatus(tx, p.id, msg.tenantId, "paid", fromStatusesFor("paid"), msg.actorId);
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.violationPaid,
        eventType: EVENTS.violationPaid,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { violationId: p.id, paymentRef: p.paymentRef },
      });
      // Citizen-meaningful outcome: payment confirmed. `updated` is the
      // just-updated row (updateStatus's RETURNING), so no extra read for
      // vehicleNumber.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: updated.vehicleNumber,
        variables: { violationId: p.id, violationNumber: updated.violationNumber, status: "paid" },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "violation.pay",
        resourceType: "parking_violation",
        resourceId: p.id,
        // paymentRef isn't a column on this table yet (flagged separately as a
        // gap — see PR description); recording it in the audit details at least
        // means it isn't lost entirely.
        details: { paymentRef: p.paymentRef },
      });
    });
  });

  queue.subscribe(COMMANDS.contestViolation, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const updated = await repo.updateStatus(tx, p.id, msg.tenantId, "contested", fromStatusesFor("contested"), msg.actorId);
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.violationContested,
        eventType: EVENTS.violationContested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { violationId: p.id, reason: p.reason },
      });
      // Citizen-meaningful outcome: contest received/acknowledged.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: updated.vehicleNumber,
        variables: { violationId: p.id, violationNumber: updated.violationNumber, status: "contested" },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "violation.contest",
        resourceType: "parking_violation",
        resourceId: p.id,
        // Same gap as above: contest reason has no column on this table yet.
        details: { reason: p.reason },
      });
    });
  });
}
