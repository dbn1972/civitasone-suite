import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCES } from "../../topics.js";
import * as repo from "./repo.js";
import type { AdministrativeUnitView } from "./schema.js";
import type { CreateUnitBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCES.unit, id);
}

export function registerHierarchyConsumers(queue: Queue): void {
  queue.subscribe<AdministrativeUnitView>(COMMANDS.unitCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        code: p.code,
        name: p.name,
        type: p.type as "state" | "district" | "block" | "gp" | "ward" | "zone",
        parentId: p.parentId,
        population: p.population,
        areaKm2: p.areaKm2,
        pinCodes: p.pinCodes,
        lgdCode: p.lgdCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.unitCreated, { unitId: p.id, code: p.code, name: p.name, type: p.type }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCES.unit);
  });

  queue.subscribe<{ id: string } & Record<string, unknown>>(COMMANDS.unitUpdate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { id, ...data } = msg.payload;
      await repo.update(tx, id as string, msg.tenantId, { ...data, updatedBy: msg.actorId });
      await emit(tx, msg, EVENTS.unitUpdated, { unitId: id }, "update", id as string);
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id as string));
    await cache.invalidateResource(msg.tenantId, RESOURCES.unit);
  });

  queue.subscribe<{ batchId: string; units: CreateUnitBody[] }>(COMMANDS.unitBulkSync, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const unit of msg.payload.units) {
        const id = crypto.randomUUID();
        await repo.insert(tx, {
          id,
          tenantId: msg.tenantId,
          code: unit.code,
          name: unit.name,
          type: unit.type as "state" | "district" | "block" | "gp" | "ward" | "zone",
          parentId: unit.parentId ?? null,
          population: unit.population ?? null,
          areaKm2: unit.areaKm2 ?? null,
          pinCodes: unit.pinCodes ?? null,
          lgdCode: unit.lgdCode ?? null,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
      }
      await emit(tx, msg, EVENTS.unitBulkSynced, { batchId: msg.payload.batchId, count: msg.payload.units.length }, "bulkSync", msg.payload.batchId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCES.unit);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "location", action, resourceType: "unit", resourceId, outcome: "success" },
  });
}
