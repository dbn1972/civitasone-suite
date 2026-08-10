import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, municipalDecisionNotificationEventType } from "../../shared/cross-events.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "event.nocs.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerNocConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.requestNoc, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      applicationId: string;
      department: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertNocRequest(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        department: p.department,
        status: "requested",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.nocRequested,
        eventType: EVENTS.nocRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          nocId: p.id,
          applicationId: p.applicationId,
          department: p.department,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "noc.request",
        resourceType: "event_noc_request",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, department: p.department }, "NOC requested");
  });

  queue.subscribe(COMMANDS.respondNoc, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      status: string;
      conditions?: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.respondNoc(tx, p.id, msg.tenantId, p.status, p.conditions ?? null, msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.nocResponded,
        eventType: EVENTS.nocResponded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { nocId: p.id, status: p.status },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "noc.respond",
        resourceType: "event_noc_request",
        resourceId: p.id,
      });
    });
  });
}
