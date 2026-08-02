import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export interface TriggerCreatePayload {
  id: string;
  ruleType: string;
  name: string;
  sourceCategory: string | null;
  targetCategory: string;
  eventCode: string | null;
  conditions: Record<string, unknown>;
  priority: number;
  weightBps: number;
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface TriggerUpdatePayload {
  id: string;
  version: number;
  patch: Record<string, unknown>;
}

export interface TriggerDeactivatePayload {
  id: string;
}

function revivePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };
  for (const key of ["effectiveFrom", "effectiveTo"] as const) {
    const v = out[key];
    if (typeof v === "string") out[key] = new Date(v);
  }
  return out;
}

export async function handleTriggerCreate(msg: CommandEnvelope<TriggerCreatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.insert(tx, {
      id: p.id,
      tenantId: msg.tenantId,
      ruleType: p.ruleType,
      name: p.name,
      sourceCategory: p.sourceCategory,
      targetCategory: p.targetCategory,
      eventCode: p.eventCode,
      conditions: p.conditions,
      priority: p.priority,
      weightBps: p.weightBps,
      active: p.active,
      effectiveFrom: p.effectiveFrom === null ? null : new Date(p.effectiveFrom),
      effectiveTo: p.effectiveTo === null ? null : new Date(p.effectiveTo),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.triggerRuleCreated,
      eventType: EVENTS.triggerRuleCreated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        ruleId: p.id,
        ruleType: p.ruleType,
        targetCategory: p.targetCategory,
        priority: p.priority,
        weightBps: p.weightBps,
      },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "trigger.create",
      resourceType: "trigger_rule",
      resourceId: p.id,
    });
  });
  await cache.invalidate(cache.makeKey(msg.tenantId, "trigger-rule", p.id));
}

export async function handleTriggerUpdate(msg: CommandEnvelope<TriggerUpdatePayload>): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const patch = revivePatch({ ...p.patch, updatedBy: msg.actorId });
    const ok = await repo.update(tx, p.id, msg.tenantId, patch, p.version);
    if (!ok) return;
    await enqueue(tx, {
      topic: EVENTS.triggerRuleUpdated,
      eventType: EVENTS.triggerRuleUpdated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { ruleId: p.id, patch },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "trigger.update",
      resourceType: "trigger_rule",
      resourceId: p.id,
    });
    applied = true;
  });
  if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "trigger-rule", p.id));
}

export async function handleTriggerDeactivate(
  msg: CommandEnvelope<TriggerDeactivatePayload>,
): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const ok = await repo.deactivate(tx, p.id, msg.tenantId, msg.actorId);
    if (!ok) return;
    await enqueue(tx, {
      topic: EVENTS.triggerRuleDeactivated,
      eventType: EVENTS.triggerRuleDeactivated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { ruleId: p.id },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "trigger.deactivate",
      resourceType: "trigger_rule",
      resourceId: p.id,
    });
    applied = true;
  });
  if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "trigger-rule", p.id));
}
