import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import {
  emitMunicipalNotification,
  municipalDecisionNotificationEventType,
  MUNICIPAL_EVENT_TYPES,
} from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as regRepo from "../registrations/repo.js";

const log = pino({ name: "vendor.committee.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerCommitteeConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // assignCommitteeReview / completeCommitteeReview (below) and
  // allocateZone (further below) are deliberately left unwired for
  // cross-service notifications: pure officer workflow steps (committee
  // assignment/findings, internal zone bookkeeping) with no citizen-facing
  // decision of their own -- the eventual citizen-facing outcome
  // (approveRegistration/rejectRegistration) is already wired below. Same
  // reasoning trade-service applied to scrutiny initiate/complete (PR
  // #1022): the intermediate step isn't itself the moment a citizen needs
  // to hear from us.
  queue.subscribe(COMMANDS.assignCommitteeReview, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      registrationId: string;
      committeeType: string;
    };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // regRepo.updateStatus's boolean return (registration actually matched
      // tenant+id) was previously discarded, so a committee-review record
      // could get inserted, and a committeeReviewAssigned event + audit
      // record published, for a registration that was never actually moved
      // to "under_review". Check it FIRST so a failed precondition creates
      // no orphaned review record at all.
      const ok = await regRepo.updateStatus(tx, p.registrationId, msg.tenantId, "under_review", msg.actorId);
      if (!ok) return;
      applied = true;
      await repo.insertReview(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        registrationId: p.registrationId,
        committeeType: p.committeeType,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.committeeReviewAssigned,
        eventType: EVENTS.committeeReviewAssigned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          reviewId: p.id,
          registrationId: p.registrationId,
          committeeType: p.committeeType,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "committee.assign",
        resourceType: "vendor_committee_review",
        resourceId: p.id,
      });
    });
    // GET /v1/vendor/registrations/:id (registrations/routes.ts) reads
    // through a cache that only this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "registration", p.registrationId));
    if (applied) log.info({ id: p.id, registrationId: p.registrationId }, "committee review assigned");
  });

  queue.subscribe(COMMANDS.completeCommitteeReview, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      findings: Record<string, unknown>;
      recommendation: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.completeReview(tx, p.id, msg.tenantId, "reviewed", p.findings, p.recommendation, msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.committeeReviewCompleted,
        eventType: EVENTS.committeeReviewCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { reviewId: p.id, recommendation: p.recommendation },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "committee.complete",
        resourceType: "vendor_committee_review",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.allocateZone, async (msg) => {
    const p = msg.payload as {
      registrationId: string;
      tenantId: string;
      zone: string;
      spot: string;
    };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await regRepo.allocateZone(tx, p.registrationId, msg.tenantId, p.zone, p.spot, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.zoneAllocated,
        eventType: EVENTS.zoneAllocated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.registrationId, zone: p.zone, spot: p.spot },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "zone.allocate",
        resourceType: "vendor_registration",
        resourceId: p.registrationId,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "registration", p.registrationId));
    if (applied) log.info({ registrationId: p.registrationId, zone: p.zone }, "zone allocated");
  });

  queue.subscribe(COMMANDS.approveRegistration, async (msg) => {
    const p = msg.payload as { registrationId: string; tenantId: string };
    // Read before the transaction, not inside it -- regRepo.findById opens
    // its own scopedRead transaction, so calling it inside db.transaction
    // below would nest transactions on the same pool (the deadlock class
    // fixed tonight in notification-service's deliveries/consumer.ts).
    const reg = await regRepo.findById(p.registrationId, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await regRepo.updateStatus(tx, p.registrationId, msg.tenantId, "approved", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.registrationApproved,
        eventType: EVENTS.registrationApproved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.registrationId },
      });
      if (reg) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: municipalDecisionNotificationEventType(MUNICIPAL_EVENT_TYPES.statusChanged, "approved"),
          recipient: reg.vendorName,
          recipientId: p.registrationId,
          variables: { registrationId: p.registrationId, registrationNumber: reg.registrationNumber, decision: "approved" },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.approve",
        resourceType: "vendor_registration",
        resourceId: p.registrationId,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "registration", p.registrationId));
    if (applied) log.info({ registrationId: p.registrationId }, "registration approved");
  });

  queue.subscribe(COMMANDS.rejectRegistration, async (msg) => {
    const p = msg.payload as { registrationId: string; tenantId: string; reason: string };
    // citizen-facing decision, same as approval -- rejection is not "internal"
    // just because it's a negative outcome (mirrors trade-service's
    // decideApplication, which notifies both approved AND rejected).
    const reg = await regRepo.findById(p.registrationId, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await regRepo.updateStatus(tx, p.registrationId, msg.tenantId, "rejected", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.registrationRejected,
        eventType: EVENTS.registrationRejected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.registrationId, reason: p.reason },
      });
      if (reg) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: municipalDecisionNotificationEventType(MUNICIPAL_EVENT_TYPES.statusChanged, "rejected"),
          recipient: reg.vendorName,
          recipientId: p.registrationId,
          variables: {
            registrationId: p.registrationId,
            registrationNumber: reg.registrationNumber,
            decision: "rejected",
            reason: p.reason,
          },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.reject",
        resourceType: "vendor_registration",
        resourceId: p.registrationId,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "registration", p.registrationId));
    if (applied) log.info({ registrationId: p.registrationId }, "registration rejected");
  });
}
