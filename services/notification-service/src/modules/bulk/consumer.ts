import type { Queue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import { notificationCampaigns } from "./schema.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { decideGate } from "../deliveries/consent-gate.js";
import { asUserUuid, loadConsentSignals } from "../deliveries/consent-gate-io.js";
import { notificationTemplates } from "../templates/schema.js";

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

      // R1: a campaign is a commercial send, so the fan-out itself is gated —
      // a suppressed or non-consenting recipient must never even receive a send
      // command. The channel the gate evaluates is the campaign template's.
      const templateRows = await tx.select().from(notificationTemplates)
        .where(eq(notificationTemplates.id, campaign.templateId)).limit(1);
      const campaignChannel = templateRows[0]?.channel ?? "email";

      const recipients = await repo.findRecipientsByCampaign(tx, p.id);
      let skipped = 0;
      for (const r of recipients) {
        const { suppressed, dnd, prefs } = await loadConsentSignals(
          tx, msg.tenantId, r.recipientId, asUserUuid(r.recipientId),
        );
        // The CRM `marketing_consent` lookup is an HTTP call and this loop runs
        // inside a transaction, so it is deliberately NOT done here — the
        // per-recipient send consumer performs it outside its own transaction,
        // fail closed, before any adapter runs. `campaignId` in the payload is
        // what tells it this is a marketing send.
        const decision = decideGate({
          suppressed,
          dnd,
          prefs,
          candidateChannels: [campaignChannel],
          marketing: { required: false, consent: "unknown" },
        });
        // `hold` is a deferral, not a refusal: let the send consumer park it in
        // the DND hold table so the sweeper releases it when the window closes.
        if (decision.action === "skip") {
          skipped++;
          await repo.markRecipientSkipped(tx, r.id, msg.actorId);
          await enqueue(tx as Parameters<typeof enqueue>[0], {
            topic: EVENTS.consentBlocked, eventType: EVENTS.consentBlocked,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              campaignId: p.id, campaignRecipientId: r.id,
              reason: decision.reason, channel: campaignChannel,
            },
          });
          continue;
        }

        await repo.markRecipientQueued(tx, r.id, msg.actorId);
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: COMMANDS.sendNotification, eventType: COMMANDS.sendNotification,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            templateId: campaign.templateId, recipientId: r.recipientId,
            recipient: r.recipientId, tenantId: p.tenantId, variables: {},
            campaignId: p.id, category: "marketing",
          },
        });
      }
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "send_campaign", resourceType: "campaign", resourceId: p.id,
          outcome: "success", recipientCount: recipients.length, skippedByConsentGate: skipped,
        },
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
