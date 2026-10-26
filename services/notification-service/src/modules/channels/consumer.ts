import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { getAdapter } from "../../adapters/index.js";
import { maskRecipient } from "../../adapters/mask.js";
import { fetchActorEmail } from "./identity-client.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerChannelConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  // GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01: enable/disable. markProcessed, the
  // guarded write and the audit row share ONE transaction (house rule).
  q.subscribe<{ id: string; tenantId: string; enabled: boolean; reason?: string }>(
    COMMANDS.setChannelEnabled, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const res = await repo.setChannelEnabledTx(tx, p.id, msg.tenantId, p.enabled, msg.actorId);
        if (!res) return; // not this tenant's channel: nothing to change, nothing to audit
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.channelEnabledChanged, eventType: EVENTS.channelEnabledChanged,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { channelId: p.id, enabled: p.enabled },
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "notification", action: p.enabled ? "enable_channel" : "disable_channel",
            resourceType: "channel", resourceId: p.id, outcome: "success",
            before: { enabled: res.previous }, after: { enabled: p.enabled }, reason: p.reason ?? null,
          },
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.channel, "list"));
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.channel, msg.payload.id));
    },
  );
  // Owner decision #25: test-send. markProcessed, the send and the audit row share ONE
  // transaction; the recipient is the actor's own address (never from the payload) and is
  // masked in the audit row. A redelivered message is a no-op (markProcessed).
  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.testSendChannel, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ch = await repo.findChannelByIdTx(tx, msg.payload.id, msg.tenantId);
      if (!ch) return; // not this tenant's channel: nothing to send, nothing to audit
      let recipient: string | undefined;
      let outcome: "success" | "failure" = "failure";
      let reason: string | null = null;
      if (!ch.enabled) reason = "channel_disabled";
      else if (ch.type === "email") recipient = await fetchActorEmail(msg.tenantId, msg.actorId);
      else if (ch.type === "in_app") recipient = msg.actorId;
      if (!reason && !recipient) reason = "no_recipient_on_file";
      const adapter = getAdapter(ch.type);
      if (!reason && !adapter) reason = "no_adapter";
      if (!reason && adapter && recipient) {
        const res = await adapter.send({
          recipient, tenantId: msg.tenantId, userId: msg.actorId,
          subject: "CivitasOne test message",
          body: `This is a test message for the "${ch.name}" channel. If you can read it, the channel is working.`,
        });
        if (res.ok) outcome = "success"; else reason = "send_failed"; // provider detail stays in logs, not the audit row
      }
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "test_send_channel", resourceType: "channel", resourceId: ch.id,
          outcome, reason, channelType: ch.type, recipient: maskRecipient(recipient),
        },
      });
    });
  });
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
