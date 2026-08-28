import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "event.post_event.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPostEventConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.conductInspection, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      permitId: string;
      findings: Record<string, unknown>;
      damageAssessment?: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertInspection(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitId: p.permitId,
        inspectorId: msg.actorId,
        inspectedAt: new Date(),
        findings: p.findings,
        damageAssessment: p.damageAssessment ?? null,
        currency: "INR",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.inspectionConducted,
        eventType: EVENTS.inspectionConducted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { inspectionId: p.id, permitId: p.permitId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "post_inspection.conduct",
        resourceType: "event_post_inspection",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, permitId: p.permitId }, "post-event inspection conducted");
  });

  queue.subscribe(COMMANDS.decideDeposit, async (msg) => {
    // refundMinor is now always a definite, pre-validated, bounds-checked
    // numeric string computed by routes.ts's computeRefundMinor() — the `?? 0n`
    // fallback below is defense-in-depth only (e.g. a direct queue message
    // that bypassed the route), not the primary path.
    const p = msg.payload as { id: string; tenantId: string; decision: string; refundMinor?: string };
    const refundAmount = p.refundMinor ? BigInt(p.refundMinor) : 0n;
    let updated: Awaited<ReturnType<typeof repo.updateDepositDecision>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Was: return value discarded, so a duplicate/racing decide command could
      // silently overwrite an already-decided deposit (repo.ts now guards this
      // atomically via `depositDecision IS NULL` in the WHERE clause).
      updated = await repo.updateDepositDecision(tx, p.id, msg.tenantId, p.decision, refundAmount, msg.actorId);
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.depositDecided,
        eventType: EVENTS.depositDecided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { inspectionId: p.id, decision: p.decision, refundMinor: String(refundAmount) },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "deposit.decide",
        resourceType: "event_post_inspection",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, decision: p.decision, matched: updated !== null }, "deposit decided");
  });
}
