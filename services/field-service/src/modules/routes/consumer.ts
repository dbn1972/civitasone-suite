import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "field.routes.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerRouteConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.routeCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      assigneeId: string;
      routeDate: string;
      waypoints: Array<Record<string, unknown>>;
      optimizedOrder: number[];
      score: { totalDistanceKm: number; estimatedDurationMinutes: number; priorityCoverage: number };
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        assigneeId: p.assigneeId,
        routeDate: p.routeDate,
        status: "optimized",
        waypoints: p.waypoints,
        optimizedOrder: p.optimizedOrder,
        totalDistanceKm: p.score.totalDistanceKm.toString(),
        estimatedDurationMinutes: p.score.estimatedDurationMinutes,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.routeCreated,
        eventType: EVENTS.routeCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { routeId: p.id, assigneeId: p.assigneeId, date: p.routeDate, score: p.score },
      });
      await writeAudit(tx, ctxOf(msg), { action: "route.create", resourceType: "field_route", resourceId: p.id });
    });
    log.info({ id: p.id }, "route created");
  });

  queue.subscribe(COMMANDS.routeReorder, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; optimizedOrder: number[]; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { optimizedOrder: p.optimizedOrder, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.routeReordered,
        eventType: EVENTS.routeReordered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { routeId: p.id, optimizedOrder: p.optimizedOrder },
      });
      await writeAudit(tx, ctxOf(msg), { action: "route.reorder", resourceType: "field_route", resourceId: p.id });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "route", p.id));
  });
}
