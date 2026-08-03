/**
 * matrix/consumer.ts — handlers for recommendation.matrix.* commands.
 */
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

export interface MatrixCreatePayload {
  id: string;
  triggerProductId: string;
  recommendedProductId: string;
  segment: string | null;
  channel: string | null;
  priority: number;
  weightBps: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface MatrixUpdatePayload {
  id: string;
  version: number;
  patch: Record<string, unknown>;
}

export interface MatrixDeletePayload {
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

export async function handleMatrixCreate(msg: CommandEnvelope<MatrixCreatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.insert(tx, {
      id: p.id,
      tenantId: msg.tenantId,
      triggerProductId: p.triggerProductId,
      recommendedProductId: p.recommendedProductId,
      segment: p.segment,
      channel: p.channel,
      priority: p.priority,
      weightBps: p.weightBps,
      effectiveFrom: p.effectiveFrom === null ? null : new Date(p.effectiveFrom),
      effectiveTo: p.effectiveTo === null ? null : new Date(p.effectiveTo),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.matrixEntryCreated,
      eventType: EVENTS.matrixEntryCreated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        matrixId: p.id,
        triggerProductId: p.triggerProductId,
        recommendedProductId: p.recommendedProductId,
        segment: p.segment,
        channel: p.channel,
        priority: p.priority,
        weightBps: p.weightBps,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
      },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "matrix.create",
      resourceType: "matrix_entry",
      resourceId: p.id,
    });
  });
  await cache.invalidate(cache.makeKey(msg.tenantId, "matrix", p.id));
}

export async function handleMatrixUpdate(msg: CommandEnvelope<MatrixUpdatePayload>): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const patch = revivePatch({ ...p.patch, updatedBy: msg.actorId });
    const ok = await repo.update(tx, p.id, msg.tenantId, patch, p.version);
    if (!ok) return;
    await enqueue(tx, {
      topic: EVENTS.matrixEntryUpdated,
      eventType: EVENTS.matrixEntryUpdated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { matrixId: p.id, patch },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "matrix.update",
      resourceType: "matrix_entry",
      resourceId: p.id,
    });
    applied = true;
  });
  if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "matrix", p.id));
}

export async function handleMatrixDelete(msg: CommandEnvelope<MatrixDeletePayload>): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const ok = await repo.deleteById(tx, p.id, msg.tenantId);
    if (!ok) return;
    await enqueue(tx, {
      topic: EVENTS.matrixEntryDeleted,
      eventType: EVENTS.matrixEntryDeleted,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { matrixId: p.id },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "matrix.delete",
      resourceType: "matrix_entry",
      resourceId: p.id,
    });
    applied = true;
  });
  if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "matrix", p.id));
}
