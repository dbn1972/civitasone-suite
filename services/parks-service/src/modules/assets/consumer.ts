import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "parks.assets.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerAssetConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.assetCreate, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, assetCode: p.assetCode,
        assetType: p.assetType, name: p.name, location: p.location,
        area: p.area, areaUnit: p.areaUnit, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.assetCreated, eventType: EVENTS.assetCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { assetId: p.id, assetCode: p.assetCode, assetType: p.assetType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "asset.create", resourceType: "parks_asset", resourceId: p.id });
    });
    log.info({ id: p.id }, "asset created");
  });

  queue.subscribe(COMMANDS.assetUpdate, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { ...p.patch, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.assetUpdated, eventType: EVENTS.assetUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { assetId: p.id, fields: Object.keys(p.patch) },
      });
      await writeAudit(tx, ctxOf(msg), { action: "asset.update", resourceType: "parks_asset", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "asset updated");
  });

  queue.subscribe(COMMANDS.assetMaintenance, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findById(p.id, msg.tenantId);
      if (!existing) return;
      const history = (existing.maintenanceHistory ?? []) as Record<string, unknown>[];
      history.push({ ...p.maintenanceEntry, recordedAt: new Date().toISOString(), recordedBy: msg.actorId });
      const ok = await repo.update(tx, p.id, msg.tenantId, {
        maintenanceHistory: history,
        lastMaintenanceDate: new Date().toISOString().slice(0, 10),
        updatedBy: msg.actorId,
      }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.assetMaintenanceRecorded, eventType: EVENTS.assetMaintenanceRecorded,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { assetId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "asset.maintenance", resourceType: "parks_asset", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "maintenance recorded");
  });
}
