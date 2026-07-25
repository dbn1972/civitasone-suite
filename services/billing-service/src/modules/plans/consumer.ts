import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerPlansConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  queue.subscribe<{ id: string; name: string; code: string; priceMinor: number; currency?: string; govtExempt?: boolean }>(COMMANDS.planCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: msg.payload.id, name: msg.payload.name, code: msg.payload.code,
        priceMinor: BigInt(msg.payload.priceMinor), currency: msg.payload.currency ?? "INR",
        govtExempt: msg.payload.govtExempt ?? true, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "billing", action: "plan_create", resourceType: "plan", resourceId: msg.payload.id, outcome: "success" },
      });
    });
    await cache.invalidate("billing:platform:plans");
  });
}
