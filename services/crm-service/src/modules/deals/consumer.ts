import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as contactRepo from "../contacts/repo.js";
import { invalidateDashboard } from "../dashboard/queries.js";
import type { DealView } from "./schema.js";

const RESOURCE = "deal";
const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerDealConsumers(queue: Queue): void {
  queue.subscribe<DealView>(COMMANDS.createDeal, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      if (p.contactId && !(await repo.contactExists(p.tenantId, p.contactId))) {
        await emitAudit(tx, msg, "create", p.id, "rejected_cross_tenant_contact");
        return;
      }
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, stage: p.stage,
        pipelineId: p.pipelineId, stageId: p.stageId,
        valueMinor: BigInt(p.valueMinor), currency: p.currency,
        contactId: p.contactId, ownerId: p.ownerId,
        closeDate: p.closeDate, probability: p.probability,
        status: p.status,
        product: p.product, quantity: p.quantity,
        competitors: p.competitors ?? [], nextStep: p.nextStep,
        expectedCloseDate: p.expectedCloseDate,
        stageEnteredAt: p.stageEnteredAt ? new Date(p.stageEnteredAt) : new Date(),
        createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      if (p.contactId) await contactRepo.touchLastActivity(tx, p.contactId, p.tenantId);
      await emit(tx, msg, EVENTS.dealCreated, { dealId: p.id, name: p.name, contactId: p.contactId }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });

  queue.subscribe(COMMANDS.updateDealStage, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; stage: string; stageId?: string; version: number; probability?: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const result = await repo.updateStageWithVersion(
        tx, p.id, p.tenantId, p.stage, p.stageId, p.version, msg.actorId, p.probability,
      );
      if (!result.updated) {
        await emitAudit(tx, msg, "update_stage", p.id, "version_conflict");
        return;
      }
      const accountId = p.stage === "Won" ? await repo.findAccountId(tx, p.id, p.tenantId) : null;
      await emit(tx, msg, EVENTS.dealStageUpdated, {
        dealId: p.id,
        previousStage: result.previousStage,
        newStage: p.stage,
        accountId,
        transitionTimestamp: new Date().toISOString(),
      }, "update_stage", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });

  queue.subscribe(COMMANDS.updateDeal, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      valueMinor?: number; ownerId?: string | null; closeDate?: string | null; contactId?: string | null;
      product?: string | null; quantity?: number | null; competitors?: string[];
      nextStep?: string | null; expectedCloseDate?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (p.contactId && !(await repo.contactExists(p.tenantId, p.contactId))) {
        await emitAudit(tx, msg, "update", p.id, "rejected_cross_tenant_contact");
        return;
      }
      const fields: repo.DealPatch = {};
      if (p.valueMinor !== undefined) fields.valueMinor = BigInt(p.valueMinor);
      if (p.ownerId !== undefined) fields.ownerId = p.ownerId;
      if (p.closeDate !== undefined) fields.closeDate = p.closeDate;
      if (p.contactId !== undefined) fields.contactId = p.contactId;
      if (p.product !== undefined) fields.product = p.product;
      if (p.quantity !== undefined) fields.quantity = p.quantity;
      if (p.competitors !== undefined) fields.competitors = p.competitors;
      if (p.nextStep !== undefined) fields.nextStep = p.nextStep;
      if (p.expectedCloseDate !== undefined) fields.expectedCloseDate = p.expectedCloseDate;
      await repo.updateDeal(tx, p.id, p.tenantId, fields, msg.actorId);
      await emit(tx, msg, EVENTS.dealUpdated, { dealId: p.id }, "update", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });

  queue.subscribe(COMMANDS.deleteDeal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.softDelete(tx, p.id, p.tenantId, msg.actorId);
      await emit(tx, msg, EVENTS.dealDeleted, { dealId: p.id }, "delete", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
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
    topic: eventType, eventType,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "deal", resourceId, outcome: "success" },
  });
}

async function emitAudit(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "deal", resourceId, outcome },
  });
}
