import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
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
      await writeAudit(tx, ctxOf(msg), { action: "tree_request.inspect", resourceType: "parks_tree_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "tree request inspected");
  });

  queue.subscribe(COMMANDS.APPROVE_TREE_REQUEST, async (msg) => {
    const p = msg.payload as any;
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
      await writeAudit(tx, ctxOf(msg), { action: "tree_request.approve", resourceType: "parks_tree_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "tree request approved");
  });

  queue.subscribe(COMMANDS.REJECT_TREE_REQUEST, async (msg) => {
    const p = msg.payload as any;
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
      await writeAudit(tx, ctxOf(msg), { action: "tree_request.reject", resourceType: "parks_tree_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "tree request rejected");
  });

  queue.subscribe(COMMANDS.COMPLETE_TREE_REQUEST, async (msg) => {
    const p = msg.payload as any;
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
      await writeAudit(tx, ctxOf(msg), { action: "tree_request.complete", resourceType: "parks_tree_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "tree request completed");
  });
}
