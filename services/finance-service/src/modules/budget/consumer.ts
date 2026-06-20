import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertValidFY } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerBudgetConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.budgetCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; headId: string; fy: string; beMinor: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      assertValidFY(p.fy);
      await repo.insertBudget(tx, {
        id: p.id, tenantId: p.tenantId, headId: p.headId, fy: p.fy,
        beMinor: BigInt(p.beMinor), reMinor: BigInt(p.beMinor),
        allocatedMinor: 0n, utilisedMinor: 0n, currency: "INR",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "budget", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "budget", `${(msg.payload as any).headId}:${(msg.payload as any).fy}`));
  });

  queue.subscribe(COMMANDS.budgetReappropriate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reMinor: number; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateBudget(tx, p.id, { reMinor: BigInt(p.reMinor), updatedBy: msg.actorId });
      await audit(tx, msg, "re_appropriate", "budget", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "budget", p.id));
  });

  queue.subscribe(COMMANDS.sanctionCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; sanctionNo: string; purpose: string; headId: string; amountMinor: number; currency?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertSanction(tx, {
        id: p.id, tenantId: p.tenantId, sanctionNo: p.sanctionNo, purpose: p.purpose,
        headId: p.headId, amountMinor: BigInt(p.amountMinor),
        currency: p.currency ?? "INR", status: "approved",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.sanctionApproved, eventType: EVENTS.sanctionApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { sanctionId: p.id, headId: p.headId, amountMinor: p.amountMinor },
      });
      await audit(tx, msg, "create", "sanction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
