import type { Queue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import { notificationCampaigns } from "./schema.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerBulkConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  q.subscribe<{
    id: string; tenantId: string; templateId: string; name: string;
    recipients: string[]; scheduledAt?: string;
  }>(COMMANDS.createCampaign, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insertCampaign(tx, {
        id: p.id, tenantId: p.tenantId, templateId: p.templateId, name: p.name,
        status: p.scheduledAt ? "scheduled" : "draft",
        scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }, p.recipients);
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.campaignCreated, eventType: EVENTS.campaignCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { campaignId: p.id, recipientCount: p.recipients.length },
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "notification", action: "create_campaign", resourceType: "campaign", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.campaign, msg.payload.id));
  });

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.sendCampaign, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const campaignRows = await tx.select().from(notificationCampaigns).where(eq(notificationCampaigns.id, p.id)).limit(1);
      const campaign = campaignRows[0];
      if (!campaign) return;

      await repo.updateCampaignStatus(tx, p.id, "sending", msg.actorId);
      const recipients = await repo.findRecipientsByCampaign(tx, p.id);
      for (const r of recipients) {
        await repo.markRecipientQueued(tx, r.id, msg.actorId);
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: COMMANDS.sendNotification, eventType: COMMANDS.sendNotification,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            templateId: campaign.templateId, recipientId: r.recipientId,
            recipient: r.recipientId, tenantId: p.tenantId, variables: {},
          },
        });
      }
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "notification", action: "send_campaign", resourceType: "campaign", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.campaign, msg.payload.id));
  });

  q.subscribe<{ id: string }>(COMMANDS.cancelCampaign, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateCampaignStatus(tx, msg.payload.id, "cancelled", msg.actorId);
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "notification", action: "cancel_campaign", resourceType: "campaign", resourceId: msg.payload.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.campaign, msg.payload.id));
  });
}
