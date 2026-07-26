import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export const LAND_RECORD_CREATE = "location.land_record.create";
export const LAND_RECORD_MUTATE = "location.land_record.mutate";

type CreatePayload = {
  id: string;
  tenantId: string;
  surveyNo: string;
  khasraNo?: string | null;
  village: string;
  district: string;
  areaHectares: number;
  ownerName: string;
  landType: string;
  coordinates?: Array<{ lat: number; lng: number }> | null;
  documentRef?: string | null;
};

type MutatePayload = { id: string; newOwnerName: string; mutationType: string };

/**
 * SVC-113: real persistence for the land-parcel registry. The routes publish
 * commands; these consumers persist them (idempotent via markProcessed) inside
 * the tenant-GUC transaction so RLS applies to the write path.
 */
export function registerLandRecordConsumers(queue: Queue): void {
  queue.subscribe<CreatePayload>(LAND_RECORD_CREATE, withTenantConsumer(async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        surveyNo: p.surveyNo,
        khasraNo: p.khasraNo ?? null,
        village: p.village,
        district: p.district,
        areaHectares: String(p.areaHectares),
        ownerName: p.ownerName,
        landType: p.landType,
        coordinates: p.coordinates ?? null,
        documentRef: p.documentRef ?? null,
        status: "active",
        createdBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, "location.land_record.registered", { landRecordId: p.id, surveyNo: p.surveyNo }, "create", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "land_records", "list"));
  }));

  queue.subscribe<MutatePayload>(LAND_RECORD_MUTATE, withTenantConsumer(async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const n = await repo.applyMutation(tx, p.id, msg.tenantId, { ownerName: p.newOwnerName, mutationType: p.mutationType });
      if (n === 0) return;
      await emit(tx, msg, "location.land_record.mutated", { landRecordId: p.id, mutationType: p.mutationType }, "mutate", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "land_records", "list"));
  }));
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
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "location", action, resourceType: "land_record", resourceId, outcome: "success" },
  });
}
