import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculatePenaltyMinor, generateViolationNumber } from "./domain.js";

const log = pino({ name: "advertisement.enforcement.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerEnforcementConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.reportViolation, async (msg) => {
    const p = msg.payload as {
      id: string;
      permitId?: string;
      violationType: string;
      description: string;
      location: Record<string, unknown>;
    };
    const violationNumber = generateViolationNumber("ULB", Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertViolation(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        violationNumber,
        permitId: p.permitId ?? null,
        status: "reported",
        violationType: p.violationType,
        description: p.description,
        location: p.location as never,
        reportedBy: msg.actorId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.violationReported,
        eventType: EVENTS.violationReported,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { violationId: p.id, violationNumber, violationType: p.violationType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "violation.report", resourceType: "adv_violation", resourceId: p.id });
    });
    log.info({ id: p.id, violationNumber }, "violation reported");
  });

  queue.subscribe(COMMANDS.issueNotice, async (msg) => {
    const p = msg.payload as { violationId: string; noticeDetails: Record<string, unknown> };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateViolation(tx, p.violationId, msg.tenantId, {
        status: "notice_issued",
        noticeIssuedAt: new Date(),
        noticeDetails: p.noticeDetails as never,
      }, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.noticeIssued, eventType: EVENTS.noticeIssued, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { violationId: p.violationId } });
      await writeAudit(tx, ctxOf(msg), { action: "violation.issue_notice", resourceType: "adv_violation", resourceId: p.violationId });
    });
    // GET /v1/advertisement/violations/:id reads through a cache that only
    // this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "violation", p.violationId));
  });

  queue.subscribe(COMMANDS.imposePenalty, async (msg) => {
    const p = msg.payload as { violationId: string; penaltyMinor?: string };
    const violation = await repo.findById(p.violationId, msg.tenantId);
    const penaltyMinor = p.penaltyMinor ? BigInt(p.penaltyMinor) : calculatePenaltyMinor(violation?.violationType ?? "unauthorized_hoarding");
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateViolation(tx, p.violationId, msg.tenantId, {
        status: "penalty_imposed",
        penaltyMinor,
        penaltyCurrency: "INR",
        penaltyImposedAt: new Date(),
      }, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.penaltyImposed, eventType: EVENTS.penaltyImposed, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { violationId: p.violationId, penaltyMinor: String(penaltyMinor) } });
      await writeAudit(tx, ctxOf(msg), { action: "violation.impose_penalty", resourceType: "adv_violation", resourceId: p.violationId });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "violation", p.violationId));
  });

  queue.subscribe(COMMANDS.orderRemoval, async (msg) => {
    const p = msg.payload as { violationId: string; removalDeadline: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateViolation(tx, p.violationId, msg.tenantId, {
        status: "removal_ordered",
        removalOrderedAt: new Date(),
        removalDeadline: p.removalDeadline,
      }, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.removalOrdered, eventType: EVENTS.removalOrdered, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { violationId: p.violationId, removalDeadline: p.removalDeadline } });
      await writeAudit(tx, ctxOf(msg), { action: "violation.order_removal", resourceType: "adv_violation", resourceId: p.violationId });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "violation", p.violationId));
  });

  queue.subscribe(COMMANDS.recordRemoval, async (msg) => {
    const p = msg.payload as { violationId: string; removalNotes: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateViolation(tx, p.violationId, msg.tenantId, {
        status: "removed",
        removalRecordedAt: new Date(),
        removalNotes: p.removalNotes,
      }, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.removalRecorded, eventType: EVENTS.removalRecorded, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { violationId: p.violationId } });
      await writeAudit(tx, ctxOf(msg), { action: "violation.record_removal", resourceType: "adv_violation", resourceId: p.violationId });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "violation", p.violationId));
  });
}
