import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as permitRepo from "../permits/repo.js";
import * as appRepo from "../applications/repo.js";
import type { AdvApplicationRow } from "../applications/schema.js";
import { calculatePenaltyMinor, generateViolationNumber } from "./domain.js";

const log = pino({ name: "advertisement.enforcement.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

/**
 * A violation only optionally carries a permitId (an unauthorized/unpermitted
 * hoarding may have no permit at all), and the permit in turn only carries
 * applicationId, not an advertiser reference directly — resolve the full
 * chain here, before any write transaction, so issueNotice/imposePenalty
 * below can notify/challan the actual advertiser responsible when one is
 * identifiable. Mirrors permits/consumer.ts's findApplicationForPermit and
 * trade-service's findApplicationForLicence (PR #1022) for the same
 * two-hop-optional-reference shape.
 */
async function findApplicationForViolation(permitId: string | null, tenantId: string): Promise<AdvApplicationRow | null> {
  if (!permitId) return null;
  const permit = await permitRepo.findById(permitId, tenantId);
  if (!permit) return null;
  return appRepo.findById(permit.applicationId, tenantId);
}

export function registerEnforcementConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // NOTE (scoping): reportViolation below is deliberately left unwired to
  // cross-events — it is an officer-initiated observation, often before any
  // responsible advertiser has even been identified (permitId is optional
  // and frequently absent for an unauthorized hoarding at report time). The
  // first genuinely citizen(violator)-facing step in this workflow is
  // issueNotice, which is wired below — same "internal step vs. actual
  // outward communication" distinction already drawn for the scrutiny
  // module in approvals/consumer.ts.
  queue.subscribe(COMMANDS.reportViolation, async (msg) => {
    const p = msg.payload as {
      id: string;
      permitId?: string;
      violationType: string;
      description: string;
      location: Record<string, unknown>;
    };
    let violationNumber = "";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // BUG FIX (collision-prone number generation): see
      // applications/repo.ts's nextApplicationNumberSeq for the full
      // rationale — same fix, same shape, for violation_number.
      const seq = await repo.nextViolationNumberSeq(tx);
      violationNumber = generateViolationNumber("ULB", seq);
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
    // Resolved before the tx, not nested inside it (PR #1028 deadlock
    // class): a formal notice is the single most citizen-critical
    // enforcement step — a permit holder who never hears about it could
    // miss a response deadline (same reasoning as trade-service's
    // issueNotice correction, PR #1022).
    const violation = await repo.findById(p.violationId, msg.tenantId);
    const application = await findApplicationForViolation(violation?.permitId ?? null, msg.tenantId);
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
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: application?.advertiserName ?? "Permit holder",
        recipientId: application?.createdBy ?? msg.actorId,
        variables: { violationId: p.violationId, status: "notice_issued" },
      });
      await writeAudit(tx, ctxOf(msg), { action: "violation.issue_notice", resourceType: "adv_violation", resourceId: p.violationId });
    });
    // GET /v1/advertisement/violations/:id reads through a cache that only
    // this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "violation", p.violationId));
  });

  queue.subscribe(COMMANDS.imposePenalty, async (msg) => {
    const p = msg.payload as { violationId: string; penaltyMinor?: string };
    const violation = await repo.findById(p.violationId, msg.tenantId);
    // Resolved before the tx, not nested inside it (PR #1028 deadlock
    // class): the penalty fee challan and the citizen notification both
    // need the responsible advertiser's identity.
    const application = await findApplicationForViolation(violation?.permitId ?? null, msg.tenantId);
    // BUG FIX (money field): p.penaltyMinor is now validated + normalized to
    // a canonical base-10 digit string by zMoneyMinorStringNonNeg at the
    // route (enforcement/routes.ts penaltyBody) before the command is ever
    // published, so BigInt() here can no longer throw on malformed input
    // inside the write transaction (previously a bare z.string() let any
    // non-numeric string reach this BigInt() call post-202).
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
      // Cross-service wiring: the penalty is now genuinely due — raise the
      // challan atomically with the status transition that creates the
      // obligation. emitMunicipalFeeChallan no-ops for amountMinor <= 0n
      // (never the case here — calculatePenaltyMinor's floor is a nonzero
      // base penalty) and enforces its own defensive ceiling.
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: p.violationId,
        depositor: application?.advertiserName ?? p.violationId,
        amountMinor: penaltyMinor,
      });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.feeDue,
        recipient: application?.advertiserName ?? "Permit holder",
        recipientId: application?.createdBy ?? msg.actorId,
        variables: { violationId: p.violationId, penaltyMinor: String(penaltyMinor) },
      });
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
