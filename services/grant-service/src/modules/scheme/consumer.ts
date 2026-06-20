import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

export function registerSchemeConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.schemeCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; code: string; name: string;
      sanctionRef?: string; budgetMinor: number; minAmountMinor: number;
      maxAmountMinor: number; currency?: string; openAt?: string; closeAt?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertScheme(tx, {
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name,
        sanctionRef: p.sanctionRef ?? null,
        budgetMinor: BigInt(p.budgetMinor),
        disbursedMinor: 0n,
        minAmountMinor: BigInt(p.minAmountMinor ?? 0),
        maxAmountMinor: BigInt(p.maxAmountMinor),
        currency: p.currency ?? "INR",
        status: "active",
        openAt: p.openAt ? new Date(p.openAt) : null,
        closeAt: p.closeAt ? new Date(p.closeAt) : null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.schemeCreated, eventType: EVENTS.schemeCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { schemeId: p.id },
      });
      await audit(tx, msg, "create", "grant_scheme", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "scheme", p.id));
  });

  queue.subscribe(COMMANDS.eligibilityCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; schemeId: string; criterionKey: string;
      minValue?: string; maxValue?: string; allowedValues?: string[]; description?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCriterion(tx, {
        id: p.id, tenantId: p.tenantId, schemeId: p.schemeId,
        criterionKey: p.criterionKey,
        minValue: p.minValue ?? null,
        maxValue: p.maxValue ?? null,
        allowedValues: p.allowedValues ?? null,
        description: p.description ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "grant_eligibility_criterion", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "scheme_criteria", p.schemeId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "grant", action, resourceType, resourceId, outcome: "success" },
  });
}
