import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalNotification } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as permitRepo from "../permits/repo.js";
import * as appRepo from "../applications/repo.js";

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
    // Resolve who to notify BEFORE opening the write transaction (same
    // convention as permits/consumer.ts's revokePermit above) — this is a
    // two-hop chain (inspection -> permit -> application) purely to find the
    // organiser, not part of the decision logic itself, so it must not run
    // as a scopedRead call from inside an already-open db.transaction (the
    // deadlock class fixed in building-service PR #1035).
    const inspectionForNotify = await repo.findById(p.id, msg.tenantId);
    const permitForNotify = inspectionForNotify
      ? await permitRepo.findById(inspectionForNotify.permitId, msg.tenantId)
      : null;
    const applicationForNotify = permitForNotify
      ? await appRepo.findById(permitForNotify.applicationId, msg.tenantId)
      : null;
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
      // Cross-service wiring: the deposit decision is directly, materially
      // citizen-facing (it decides how much of their own money comes back),
      // unlike conductInspection above which is an internal record with no
      // decision attached yet. This is a notification only — NOT a second
      // finance.challan.create — the deposit was already collected as part
      // of the single combined challan raised at application creation
      // (applications/consumer.ts); actually disbursing refundAmount back to
      // the organiser is a separate concern (refund-service), out of scope
      // for this service's Wave 3 wiring.
      if (applicationForNotify) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: EVENTS.depositDecided,
          recipient: applicationForNotify.createdBy,
          recipientId: p.id,
          variables: {
            inspectionId: p.id,
            decision: p.decision,
            refundMinor: String(refundAmount),
            applicationId: applicationForNotify.id,
          },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "deposit.decide",
        resourceType: "event_post_inspection",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, decision: p.decision, matched: updated !== null }, "deposit decided");
  });
}
