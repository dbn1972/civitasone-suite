import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { calculateRiskScore } from "./domain.js";
import * as repo from "./repo.js";

const log = pino({ name: "swm.analytics.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerAnalyticsConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.hotspotIdentify, async (msg) => {
    const p = msg.payload as any;
    const riskScore = calculateRiskScore(p.complaintCount);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, hotspotCode: p.hotspotCode,
        location: p.location, category: p.category,
        complaintCount: p.complaintCount, riskScore, status: "identified",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.hotspotIdentified, eventType: EVENTS.hotspotIdentified,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { hotspotId: p.id, hotspotCode: p.hotspotCode, riskScore },
      });
      await writeAudit(tx, ctxOf(msg), { action: "hotspot.identify", resourceType: "swm_hotspot", resourceId: p.id });
    });
    log.info({ id: p.id, riskScore }, "hotspot identified");
  });

  queue.subscribe(COMMANDS.hotspotResolve, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "resolved", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.hotspotResolved, eventType: EVENTS.hotspotResolved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { hotspotId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "hotspot.resolve", resourceType: "swm_hotspot", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "hotspot resolved");
  });
}
