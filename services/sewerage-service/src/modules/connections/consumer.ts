import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "sewerage.connections.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerConnectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.connectionApply, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApp(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber: p.applicationNumber,
        status: "submitted",
        propertyRef: p.propertyRef,
        waterConnectionRef: p.waterConnectionRef,
        connectionClass: p.connectionClass,
        siteDetails: p.siteDetails,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.connectionApplied,
        eventType: EVENTS.connectionApplied,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id, applicationNumber: p.applicationNumber },
      });
      await writeAudit(tx, ctxOf(msg), { action: "connection.apply", resourceType: "sewerage_application", resourceId: p.id });
    });
    log.info({ id: p.id }, "connection application created");
  });

  queue.subscribe(COMMANDS.connectionUpdateStatus, async (msg) => {
    const p = msg.payload as any;
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
      await writeAudit(tx, ctxOf(msg), { action: "connection.update_status", resourceType: "sewerage_application", resourceId: p.id, details: { status: p.status } });
    });
    if (applied) log.info({ id: p.id, status: p.status }, "application status updated");
  });

  queue.subscribe(COMMANDS.connectionActivate, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateApp(tx, p.applicationId, msg.tenantId, { status: "activated", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      await repo.insertConnection(tx, {
        id: p.connectionId,
        tenantId: msg.tenantId,
        connectionNumber: p.connectionNumber,
        applicationId: p.applicationId,
        status: "active",
        activationDate: new Date().toISOString().slice(0, 10),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.connectionActivated,
        eventType: EVENTS.connectionActivated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { connectionId: p.connectionId, connectionNumber: p.connectionNumber, applicationId: p.applicationId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "connection.activate", resourceType: "sewerage_connection", resourceId: p.connectionId });
    });
    log.info({ connectionId: p.connectionId }, "connection activated");
  });
}
