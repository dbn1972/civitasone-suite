import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";

export function registerSchemeConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.schemeCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; code: string; name: string;
      sanctionRef?: string; budgetMinor: number; minAmountMinor: number;
      maxAmountMinor: number; currency?: string; openAt?: string; closeAt?: string;
      reportingFrequencyDays?: number;
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
        reportingFrequencyDays: p.reportingFrequencyDays ?? 90,
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
  queue.subscribe(COMMANDS.schemeUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; updatedBy: string;
      name?: string; sanctionRef?: string; budgetMinor?: number;
      maxAmountMinor?: number; openAt?: string; closeAt?: string;
      reportingFrequencyDays?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const patch: Parameters<typeof repo.updateScheme>[2] = { updatedBy: p.updatedBy };
      if (p.name !== undefined)                   patch.name = p.name;
      if (p.sanctionRef !== undefined)            patch.sanctionRef = p.sanctionRef;
      if (p.budgetMinor !== undefined)            patch.budgetMinor = BigInt(p.budgetMinor);
      if (p.maxAmountMinor !== undefined)         patch.maxAmountMinor = BigInt(p.maxAmountMinor);
      if (p.reportingFrequencyDays !== undefined) patch.reportingFrequencyDays = p.reportingFrequencyDays;
      if (p.openAt !== undefined)                 patch.openAt = new Date(p.openAt);
      if (p.closeAt !== undefined)                patch.closeAt = new Date(p.closeAt);
      await repo.updateScheme(tx, p.id, patch);
      await enqueue(tx, {
        topic: EVENTS.schemeUpdated, eventType: EVENTS.schemeUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { schemeId: p.id },
      });
      await audit(tx, msg, "update", "grant_scheme", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "scheme", p.id));
  });

  queue.subscribe(COMMANDS.schemeClose, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; closedBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateScheme(tx, p.id, {
        status: "closed",
        closeAt: new Date(),
        updatedBy: p.closedBy,
      });
      await enqueue(tx, {
        topic: EVENTS.schemeClosed, eventType: EVENTS.schemeClosed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { schemeId: p.id },
      });
      await audit(tx, msg, "close", "grant_scheme", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "scheme", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "grant", action, resourceType, resourceId, outcome: "success" },
  });
}
