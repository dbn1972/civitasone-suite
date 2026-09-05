import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalNotification, municipalDecisionNotificationEventType, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { formatRequestNumber } from "./domain.js";

const log = pino({ name: "parks.tree_requests.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerTreeRequestConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.CREATE_TREE_REQUEST, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Reserved inside this transaction (see repo.nextRequestNumber) —
      // replaces the old `PRKT-${Date.now()}` scheme, which collided under
      // concurrent load and had no DB-level guarantee of uniqueness beyond
      // the UNIQUE constraint rejecting the second insert outright.
      const requestNumber = formatRequestNumber(await repo.nextRequestNumber(tx));
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, requestNumber,
        requestedBy: p.requestedBy, requestType: p.requestType,
        location: p.location, treeSpecies: p.treeSpecies,
        reason: p.reason, photos: p.photos, status: "submitted",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.TREE_REQUEST_CREATED, eventType: EVENTS.TREE_REQUEST_CREATED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { requestId: p.id, requestNumber, requestType: p.requestType },
      });
      // Citizen-meaningful: acknowledgement that the request was received,
      // with a reference number to track it. requestedBy is supplied
      // directly on this command's payload, so no pre-tx lookup is needed.
      // parks_tree_requests has no citizen display-name column (only the
      // requestedBy uuid), so `recipient` is the request's own
      // human-readable reference number — same fallback complaints/
      // consumer.ts uses in this same service, for the identical reason.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: requestNumber,
        recipientId: p.requestedBy,
        variables: { requestId: p.id, requestNumber, requestType: p.requestType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "tree_request.submit", resourceType: "parks_tree_request", resourceId: p.id });
    });
    log.info({ id: p.id }, "tree request submitted");
  });

  queue.subscribe(COMMANDS.INSPECT_TREE_REQUEST, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, {
        status: "inspected", inspectorId: p.inspectorId,
        inspectionReport: p.inspectionReport, updatedBy: msg.actorId,
      }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.TREE_REQUEST_INSPECTED, eventType: EVENTS.TREE_REQUEST_INSPECTED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { requestId: p.id, inspectorId: p.inspectorId },
      });
      // Deliberately NOT wired: pure officer workflow (an inspector has
      // visited and filed findings) with no decision yet — the request
      // stays pending either approval or rejection. Mirrors the scoping
      // call building-service/advertisement-service make for their own
      // scrutiny/review steps (initiateScrutiny/completeScrutiny): the
      // eventual citizen-facing outcome (APPROVE/REJECT below) is what
      // gets wired, not the intermediate review itself.
      await writeAudit(tx, ctxOf(msg), { action: "tree_request.inspect", resourceType: "parks_tree_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "tree request inspected");
  });

  queue.subscribe(COMMANDS.APPROVE_TREE_REQUEST, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction —
    // requestNumber/requestedBy aren't in this command's payload ({id,
    // tenantId, approvedBy, version} only). See RESOLVE_COMPLAINT in
    // complaints/consumer.ts for the full nested-transaction-deadlock
    // rationale (PR #1028/#1035) this avoids.
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "approved", approvedBy: p.approvedBy, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.TREE_REQUEST_APPROVED, eventType: EVENTS.TREE_REQUEST_APPROVED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { requestId: p.id, approvedBy: p.approvedBy },
      });
      // Citizen-meaningful decision. municipalDecisionNotificationEventType
      // resolves "approved" to the real citizen.application.approved
      // template (see advertisement-service's/building-service's
      // decideApplication for the identical pattern).
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: municipalDecisionNotificationEventType(EVENTS.TREE_REQUEST_APPROVED, "approved"),
          recipient: existing.requestNumber,
          recipientId: existing.requestedBy,
          variables: { requestId: p.id, requestNumber: existing.requestNumber, decision: "approved" },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "tree_request.approve", resourceType: "parks_tree_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "tree request approved");
  });

  queue.subscribe(COMMANDS.REJECT_TREE_REQUEST, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction — same
    // rationale as APPROVE_TREE_REQUEST above.
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "rejected", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.TREE_REQUEST_REJECTED, eventType: EVENTS.TREE_REQUEST_REJECTED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { requestId: p.id },
      });
      // Citizen-meaningful decision too — a rejection is exactly the kind
      // of outcome the citizen needs to know about. "rejected" has no
      // dedicated system template today (only "approved" does, via
      // municipalDecisionNotificationEventType), so this resolves to the
      // generic default template — still delivered, just not on a
      // dedicated one. Same outcome advertisement-service accepts for its
      // own non-approved decisions.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: municipalDecisionNotificationEventType(EVENTS.TREE_REQUEST_REJECTED, "rejected"),
          recipient: existing.requestNumber,
          recipientId: existing.requestedBy,
          variables: { requestId: p.id, requestNumber: existing.requestNumber, decision: "rejected" },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "tree_request.reject", resourceType: "parks_tree_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "tree request rejected");
  });

  queue.subscribe(COMMANDS.COMPLETE_TREE_REQUEST, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction — same
    // rationale as APPROVE_TREE_REQUEST above.
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "completed", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.TREE_REQUEST_COMPLETED, eventType: EVENTS.TREE_REQUEST_COMPLETED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { requestId: p.id },
      });
      // Citizen-meaningful: the approved tree work (pruning/removal/
      // planting/transplant) has actually been carried out — the final
      // milestone after APPROVE_TREE_REQUEST.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.requestNumber,
          recipientId: existing.requestedBy,
          variables: { requestId: p.id, requestNumber: existing.requestNumber, status: "completed" },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "tree_request.complete", resourceType: "parks_tree_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "tree request completed");
  });
}
