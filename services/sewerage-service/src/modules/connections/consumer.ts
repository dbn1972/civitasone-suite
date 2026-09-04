import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { formatApplicationNumber, formatConnectionNumber } from "./domain.js";
import * as repo from "./repo.js";

const log = pino({ name: "sewerage.connections.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerConnectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.connectionApply, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    let applicationNumber = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Reserved inside this transaction (see repo.nextApplicationNumber) —
      // replaces the old `SEW-${Date.now()}` scheme.
      applicationNumber = formatApplicationNumber(await repo.nextApplicationNumber(tx));
      await repo.insertApp(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "submitted",
        propertyRef: p.propertyRef,
        waterConnectionRef: p.waterConnectionRef,
        connectionClass: p.connectionClass,
        siteDetails: p.siteDetails,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.connectionApplied,
        eventType: EVENTS.connectionApplied,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id, applicationNumber },
      });
      // Citizen-meaningful: this command IS the submission (there is no
      // separate draft->submit step in this module, unlike shop-service's
      // registrations), and the actor here is the applicant themselves
      // (connections/commands.ts's applyConnection publishes with
      // ctx.actorId as msg.actorId) — no pre-tx recipient lookup needed,
      // unlike the later admin-triggered transitions below.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: applicationNumber,
        recipientId: p.id,
        variables: { applicationId: p.id, applicationNumber },
      });
      await writeAudit(tx, ctxOf(msg), { action: "connection.apply", resourceType: "sewerage_application", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "connection application created");
  });

  queue.subscribe(COMMANDS.connectionUpdateStatus, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction — this
    // handler is admin-triggered (connections/routes.ts's status endpoint
    // requires ADMIN_ROLES) and its payload carries only {id, status,
    // version}, no applicationNumber. repo.findAppById opens its own
    // scopedRead transaction, so calling it from inside db.transaction
    // below would nest transactions on the same connection pool — the
    // exact deadlock class fixed in PR #1028 (notification-service's
    // checkQuota/checkDlt nested inside the outer send transaction).
    const existing = await repo.findAppById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateApp(tx, p.id, msg.tenantId, { status: p.status, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.connectionStatusUpdated,
        eventType: EVENTS.connectionStatusUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id, status: p.status },
      });
      // Citizen-meaningful: every reachable target status here
      // (feasibility_check, estimate_issued, payment_pending, work_ordered,
      // rejected — see domain.ts's APP_TRANSITIONS) is something the
      // applicant needs to know about, rejected most of all — this is not
      // an internal bookkeeping transition.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.applicationNumber,
          recipientId: p.id,
          variables: { applicationId: p.id, applicationNumber: existing.applicationNumber, status: p.status },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "connection.update_status", resourceType: "sewerage_application", resourceId: p.id, details: { status: p.status } });
    });
    if (applied) log.info({ id: p.id, status: p.status }, "application status updated");
  });

  queue.subscribe(COMMANDS.connectionActivate, async (msg) => {
    const p = msg.payload as any;
    // NOTE (fixed in passing): this handler's final log.info previously sat
    // unconditionally OUTSIDE the ok-guard below (the only consumer in this
    // service that did), so a dropped/no-op activation (stale version,
    // already-activated application) still logged "connection activated"
    // despite writing nothing — same bug shape as the SCHEDULE_INSPECTION
    // consumer fix noted in parks-service's PR #1010.
    let applied = false;
    let connectionNumber = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateApp(tx, p.applicationId, msg.tenantId, { status: "activated", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      connectionNumber = formatConnectionNumber(await repo.nextConnectionNumber(tx));
      await repo.insertConnection(tx, {
        id: p.connectionId,
        tenantId: msg.tenantId,
        connectionNumber,
        applicationId: p.applicationId,
        status: "active",
        activationDate: new Date().toISOString().slice(0, 10),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.connectionActivated,
        eventType: EVENTS.connectionActivated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { connectionId: p.connectionId, connectionNumber, applicationId: p.applicationId },
      });
      // Citizen-meaningful: the connection just went live — the applicant's
      // sewerage connection is now active and usable. connectionNumber is
      // reserved inside this same transaction, so no pre-tx lookup is
      // needed for the recipient reference string.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.permitIssued,
        recipient: connectionNumber,
        recipientId: p.connectionId,
        variables: { connectionId: p.connectionId, connectionNumber, applicationId: p.applicationId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "connection.activate", resourceType: "sewerage_connection", resourceId: p.connectionId });
    });
    if (applied) log.info({ connectionId: p.connectionId }, "connection activated");
  });
}
