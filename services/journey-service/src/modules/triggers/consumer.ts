import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "journey.triggers.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerTriggerConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.triggerCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      journeyId: string;
      triggerType: string;
      config: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        journeyId: p.journeyId,
        triggerType: p.triggerType,
        config: p.config,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.triggerCreated,
        eventType: EVENTS.triggerCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { triggerId: p.id, journeyId: p.journeyId, triggerType: p.triggerType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "trigger.create", resourceType: "journey_trigger", resourceId: p.id });
    });
    log.info({ id: p.id }, "trigger created");
  });

  queue.subscribe(COMMANDS.triggerUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number; patch: Record<string, unknown> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, p.patch, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.triggerUpdated,
        eventType: EVENTS.triggerUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { triggerId: p.id, fields: Object.keys(p.patch) },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "trigger.update",
        resourceType: "journey_trigger",
        resourceId: p.id,
        details: { fields: Object.keys(p.patch) },
      });
    });
  });

  queue.subscribe(COMMANDS.triggerDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.softDelete(tx, p.id, msg.tenantId, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.triggerDeleted,
        eventType: EVENTS.triggerDeleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { triggerId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "trigger.delete", resourceType: "journey_trigger", resourceId: p.id });
    });
  });
}
