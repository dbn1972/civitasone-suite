import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateViolationNumber, calculateFineMinor } from "./domain.js";

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
    const violationNumber = generateViolationNumber("ULB", Date.now() % 999999);
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
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "paid", msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.violationPaid,
        eventType: EVENTS.violationPaid,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { violationId: p.id, paymentRef: p.paymentRef },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "violation.pay",
        resourceType: "parking_violation",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.contestViolation, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "contested", msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.violationContested,
        eventType: EVENTS.violationContested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { violationId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "violation.contest",
        resourceType: "parking_violation",
        resourceId: p.id,
      });
    });
  });
}
