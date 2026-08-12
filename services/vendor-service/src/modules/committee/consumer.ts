import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as regRepo from "../registrations/repo.js";

const log = pino({ name: "vendor.committee.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerCommitteeConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.assignCommitteeReview, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      registrationId: string;
      committeeType: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertReview(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        registrationId: p.registrationId,
        committeeType: p.committeeType,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await regRepo.updateStatus(tx, p.registrationId, msg.tenantId, "under_review", msg.actorId);
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
    log.info({ id: p.id, registrationId: p.registrationId }, "committee review assigned");
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
      await repo.completeReview(tx, p.id, msg.tenantId, "reviewed", p.findings, p.recommendation, msg.actorId);
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
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await regRepo.allocateZone(tx, p.registrationId, msg.tenantId, p.zone, p.spot, msg.actorId);
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
    log.info({ registrationId: p.registrationId, zone: p.zone }, "zone allocated");
  });

  queue.subscribe(COMMANDS.approveRegistration, async (msg) => {
    const p = msg.payload as { registrationId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await regRepo.updateStatus(tx, p.registrationId, msg.tenantId, "approved", msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.registrationApproved,
        eventType: EVENTS.registrationApproved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.registrationId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.approve",
        resourceType: "vendor_registration",
        resourceId: p.registrationId,
      });
    });
    log.info({ registrationId: p.registrationId }, "registration approved");
  });

  queue.subscribe(COMMANDS.rejectRegistration, async (msg) => {
    const p = msg.payload as { registrationId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await regRepo.updateStatus(tx, p.registrationId, msg.tenantId, "rejected", msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.registrationRejected,
        eventType: EVENTS.registrationRejected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.registrationId, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.reject",
        resourceType: "vendor_registration",
        resourceId: p.registrationId,
      });
    });
    log.info({ registrationId: p.registrationId }, "registration rejected");
  });
}
