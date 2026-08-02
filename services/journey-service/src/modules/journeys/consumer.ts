import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "journey.journeys.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

function invalidateJourney(tenantId: string, id: string): Promise<void> {
  return cache.invalidate(cache.makeKey(tenantId, "journey", id));
}

export function registerJourneyConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.journeyCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      name: string;
      triggerConfig: Record<string, unknown> | null;
      steps: Array<Record<string, unknown>>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        status: "draft",
        triggerConfig: p.triggerConfig,
        steps: p.steps,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.journeyCreated,
        eventType: EVENTS.journeyCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { journeyId: p.id, name: p.name },
      });
      await writeAudit(tx, ctxOf(msg), { action: "journey.create", resourceType: "journey", resourceId: p.id });
    });
    log.info({ id: p.id }, "journey created");
  });

  queue.subscribe(COMMANDS.journeyUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number; patch: Record<string, unknown> };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, p.patch, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.journeyUpdated,
        eventType: EVENTS.journeyUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { journeyId: p.id, fields: Object.keys(p.patch) },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "journey.update",
        resourceType: "journey",
        resourceId: p.id,
        details: { fields: Object.keys(p.patch) },
      });
    });
    if (applied) await invalidateJourney(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.journeyActivate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "active", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.journeyStarted,
        eventType: EVENTS.journeyStarted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { journeyId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "journey.activate", resourceType: "journey", resourceId: p.id });
    });
    if (applied) await invalidateJourney(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.journeyPause, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "paused", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.journeyPaused,
        eventType: EVENTS.journeyPaused,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { journeyId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "journey.pause", resourceType: "journey", resourceId: p.id });
    });
    if (applied) await invalidateJourney(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.journeyDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.softDelete(tx, p.id, msg.tenantId, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.journeyArchived,
        eventType: EVENTS.journeyArchived,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { journeyId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "journey.delete", resourceType: "journey", resourceId: p.id });
    });
    if (applied) await invalidateJourney(msg.tenantId, p.id);
  });
}
