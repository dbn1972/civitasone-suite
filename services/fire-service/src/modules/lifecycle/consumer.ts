import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as nocRepo from "../nocs/repo.js";
import { calculateRenewalFee, calculateNewValidUntil } from "./domain.js";

const log = pino({ name: "fire.lifecycle.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLifecycleConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.requestRenewal, async (msg) => {
    const p = msg.payload as { id: string; nocId: string; renewalType: string };
    const feeMinor = calculateRenewalFee(p.renewalType as never);
    const noc = await nocRepo.findById(msg.tenantId, p.nocId);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        nocId: p.nocId,
        renewalType: p.renewalType,
        status: "requested",
        feeMinor,
        previousValidUntil: noc?.validUntil ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.renewalRequested,
        eventType: EVENTS.renewalRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { renewalId: p.id, nocId: p.nocId, renewalType: p.renewalType, feeMinor: String(feeMinor) },
      });
      await writeAudit(tx, ctxOf(msg), { action: "renewal.request", resourceType: "fire_renewal", resourceId: p.id });
    });
    log.info({ id: p.id, nocId: p.nocId }, "fire renewal requested");
  });

  queue.subscribe(COMMANDS.decideRenewal, async (msg) => {
    const p = msg.payload as { renewalId: string; decision: string };
    const renewal = await repo.findById(msg.tenantId, p.renewalId);
    if (!renewal) return;

    const newValidUntil = p.decision === "approved" && renewal.renewalType === "renewal" && renewal.previousValidUntil
      ? calculateNewValidUntil(new Date(renewal.previousValidUntil)).toISOString().slice(0, 10)
      : null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const status = p.decision === "approved" ? "approved" : "rejected";
      await repo.updateDecision(tx, msg.tenantId, p.renewalId, p.decision, status, newValidUntil, msg.actorId);
      if (p.decision === "approved" && newValidUntil) {
        await nocRepo.updateStatus(tx, msg.tenantId, renewal.nocId, "active", msg.actorId);
      }
      await enqueue(tx, {
        topic: EVENTS.renewalDecided,
        eventType: EVENTS.renewalDecided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { renewalId: p.renewalId, nocId: renewal.nocId, decision: p.decision, newValidUntil },
      });
      await writeAudit(tx, ctxOf(msg), { action: `renewal.${p.decision}`, resourceType: "fire_renewal", resourceId: p.renewalId });
    });
  });
}
