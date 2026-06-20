import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerConfigConsumers(queue: Queue): void {
  queue.subscribe<{ tenantId: string; moduleKey: string; enabled: boolean }>(COMMANDS.moduleToggle, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.upsertModule(tx, msg.payload.tenantId, msg.payload.moduleKey, msg.payload.enabled, msg.actorId);
      await audit(tx, msg, "module_toggle", msg.payload.tenantId);
    });
    await cache.invalidate(cache.makeKey(msg.payload.tenantId, "config", msg.payload.tenantId));
  });

  queue.subscribe<{ flagKey: string; enabled: boolean }>(COMMANDS.featureFlagCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertFlag(tx, msg.payload.flagKey, msg.payload.enabled, msg.actorId);
      await audit(tx, msg, "feature_flag_create", msg.payload.flagKey);
    });
    await cache.invalidate("admin:platform:feature_flags");
  });

  queue.subscribe<{ flagKey: string; tenantId: string; enabled: boolean }>(COMMANDS.featureFlagOverride, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.setFlagOverride(tx, msg.payload.flagKey, msg.payload.tenantId, msg.payload.enabled, msg.actorId);
      await audit(tx, msg, "feature_flag_override", msg.payload.flagKey);
    });
    await cache.invalidate(cache.makeKey(msg.payload.tenantId, "config", msg.payload.tenantId));
  });
}

async function audit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  const t = tx as any;
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: "config", resourceId, outcome: "success" },
  });
}
