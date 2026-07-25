import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerChannelConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  q.subscribe<{ id: string; tenantId: string; type: string; name: string; isDefault: boolean; enabled: boolean }>(
    COMMANDS.createChannel, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.insertChannel(tx, {
          id: p.id, tenantId: p.tenantId, type: p.type, name: p.name,
          isDefault: p.isDefault, enabled: p.enabled,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.channelCreated, eventType: EVENTS.channelCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { channelId: p.id, type: p.type },
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "notification", action: "create_channel", resourceType: "channel", resourceId: p.id, outcome: "success" },
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.channel, "list"));
    },
  );
}
