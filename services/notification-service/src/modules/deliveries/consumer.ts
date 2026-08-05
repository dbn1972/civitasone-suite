import { randomUUID } from "node:crypto";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { maskRecipient } from "../../adapters/mask.js";
import * as repo from "./repo.js";
import { computeNextRetryAt, shouldRetry } from "./retry.js";
import {
  resolvePreferredChannel,
  resolveChannelWithDefault,
  sendWithFallback,
  CHANNEL_NONE,
} from "./channel.js";
import { notificationTemplates } from "../templates/schema.js";
import { eq } from "drizzle-orm";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as dndRepo from "../dnd/repo.js";
import {
  decideGate,
  isMarketingSend,
  type MarketingConsent,
  type SkipReason,
} from "./consent-gate.js";
import { asUserUuid, loadConsentSignals } from "./consent-gate-io.js";
import { fetchMarketingConsent, type ConsentLookup } from "./crm-consent-client.js";
import { syncCampaignRecipientOutcome } from "../bulk/repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * MK-004: when a send that was fanned out from a campaign reaches a TERMINAL
 * outcome, mirror that outcome onto the matching bulk.campaign_recipients row so
 * the campaign metrics query counts real delivered/failed numbers instead of
 * frozen zeros. No-op for non-campaign sends (no campaignId) — every existing
 * producer keeps its exact behaviour. Runs in the caller's tenant-scoped tx.
 */
async function mirrorCampaignOutcome(
  tx: Tx,
  msg: CommandEnvelope<SendPayload>,
  recipientId: string | null,
  status: string,
  deliveryId: string | null,
): Promise<void> {
  const campaignId = msg.payload.campaignId;
  if (!campaignId || !recipientId) return;
  await syncCampaignRecipientOutcome(
    tx as unknown as Parameters<typeof syncCampaignRecipientOutcome>[0],
    msg.tenantId, campaignId, recipientId, status, deliveryId, msg.actorId,
  );
}

type SendPayload = {
  // Standard shape (required): at least one of templateId or body must be present.
  templateId?: string;
  // Legacy audit/legal shape may omit recipient and use recipientId instead.
  recipient?: string;
  recipientId?: string;
  channel?: string;
  eventType?: string;
  variables?: Record<string, string>;
  deliveryId?: string;
  retryCount?: number;
  // Legacy direct-body shape (audit-service observation consumer, etc.)
  subject?: string;
  body?: string;
  // Legal cron shape (hearing-reminders)
  type?: string;
  /**
   * R1: marks the send as commercial so the CRM `marketing_consent` check
   * applies. Absent → transactional (the safe default for the existing
   * producers, which all send operational notifications).
   */
  category?: "transactional" | "marketing";
  /** Set by the bulk campaign fan-out; also implies a marketing send. */
  campaignId?: string;
};

/**
 * Test seam for the CRM consent lookup. Production always uses the real HTTP
 * client; tests swap it so they can assert the fail-closed branches without a
 * running crm-service.
 */
let consentLookup: ConsentLookup = fetchMarketingConsent;
export function setConsentLookupForTests(fn: ConsentLookup): void {
  consentLookup = fn;
}
export function resetConsentLookup(): void {
  consentLookup = fetchMarketingConsent;
}

export function registerDeliveryConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  q.subscribe<SendPayload>(COMMANDS.sendNotification, async (msg) => {
    await processSend(msg);
  });
}

async function processSend(msg: CommandEnvelope<SendPayload>): Promise<void> {
  const p = msg.payload;
  const deliveryId = p.deliveryId ?? randomUUID();
  const retryCount = p.retryCount ?? 0;

  // N1: normalize multi-shape payloads into the canonical {templateId, recipient} form.
  // Legacy audit-service sends {channel, recipient, subject, body} without a templateId.
  // Legal cron sends {type, recipientId, hearingId, hearingDate} without recipient or templateId.
  // Both shapes are valid business notifications — we synthesize a templateId (default)
  // and derive recipient from recipientId when the explicit field is absent.
  const effectiveRecipient = p.recipient ?? p.recipientId ?? msg.actorId;
  const recipientId = p.recipientId ?? null;
  const effectiveTemplateId = p.templateId ?? "00000000-0000-4000-8001-000000000000"; // SYSTEM_TEMPLATE_IDS.default
  const inlineBody = p.body;   // present only on legacy direct-body shape
  const inlineSubject = p.subject ?? undefined;

  // R1: the CRM marketing-consent lookup is an outbound HTTP call, so it runs
  // BEFORE the transaction opens — calling another service from inside a DB
  // transaction pins a pooled connection for the duration of a remote timeout.
  // It only runs for commercial sends; transactional traffic never leaves the
  // service for consent.
  const marketingRequired = isMarketingSend({
    category: p.category,
    campaignId: p.campaignId,
    eventType: p.eventType,
  });
  const marketingConsent: MarketingConsent = marketingRequired
    ? await consentLookup(recipientId ?? effectiveRecipient, msg.tenantId, msg.correlationId)
    : "unknown"; // ignored when not required — never read as consent
  const marketing = { required: marketingRequired, consent: marketingConsent };

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const templateRows = p.templateId
      ? await tx.select().from(notificationTemplates).where(eq(notificationTemplates.id, effectiveTemplateId)).limit(1)
      : [];
    const template = templateRows[0];
    const userId = recipientId ?? effectiveRecipient;
    const prefUserId = asUserUuid(userId);

    // R1: suppression, DND windows and per-channel prefs are all read here, in
    // the send transaction, so the gate below decides on the same snapshot the
    // delivery row is written against.
    const { suppressed, dnd, prefs } = await loadConsentSignals(
      tx, msg.tenantId, effectiveRecipient, prefUserId,
    );

    // P1-1: opt-out is decided from prefs FIRST, using only a CALLER-specified
    // channel (`p.channel`) as an explicit override. The template's default
    // channel must NOT be treated as an override — otherwise every template
    // (which always carries a channel) would silently defeat a recipient's
    // opt-out. The template channel is applied only as a default for a recipient
    // who has NOT opted out and expressed no preference.
    const prefResolution = resolvePreferredChannel(prefs, p.eventType, p.channel);
    const optedOut = prefResolution.optedOut;
    const channel = optedOut
      ? CHANNEL_NONE
      : await resolveChannelWithDefault(msg.tenantId, prefs, p.eventType, p.channel ?? template?.channel);
    const { preferred, fallbacks } = resolvePreferredChannel(prefs, p.eventType, optedOut ? undefined : channel);

    // P1-1: a fully opted-out recipient → record a `skipped` delivery on channel
    // `none` and send nothing. This is terminal (no retry, no fallback to email).
    if (optedOut || channel === CHANNEL_NONE) {
      if (!p.deliveryId) {
        await repo.insertDelivery(tx, {
          id: deliveryId, tenantId: msg.tenantId, templateId: effectiveTemplateId,
          recipient: effectiveRecipient, recipientId, channel: CHANNEL_NONE, status: "skipped",
          retryCount, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        });
      } else {
        await repo.updateDeliveryStatus(tx, deliveryId, "skipped", msg.actorId, retryCount + 1);
      }
      await mirrorCampaignOutcome(tx, msg, recipientId, "skipped", deliveryId);
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId,
        actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "send", resourceType: "delivery", resourceId: deliveryId,
          outcome: "skipped", channel: CHANNEL_NONE, reason: "recipient_opted_out",
        },
      });
      return;
    }

    const attemptChannels = [preferred, ...fallbacks];

    // ---------------------------------------------------------------------
    // R1 CONSENT GATE — nothing below this point may reach a channel adapter
    // until the gate clears it. suppression → marketing consent → per-channel
    // consent → DND. See consent-gate.ts for the ordering rationale.
    // ---------------------------------------------------------------------
    const decision = decideGate({
      suppressed,
      dnd,
      prefs,
      eventType: p.eventType,
      candidateChannels: attemptChannels,
      marketing,
    });

    if (decision.action === "skip") {
      await recordGateSkip(tx, msg, {
        deliveryId, hasExistingDelivery: Boolean(p.deliveryId),
        templateId: effectiveTemplateId, recipient: effectiveRecipient, recipientId,
        channel: preferred, retryCount, reason: decision.reason,
      });
      return;
    }

    if (decision.action === "hold") {
      await holdForDnd(tx, msg, {
        deliveryId, hasExistingDelivery: Boolean(p.deliveryId),
        templateId: effectiveTemplateId, recipient: effectiveRecipient, recipientId,
        channel: preferred, retryCount, userId: prefUserId, releaseAt: decision.releaseAt,
        payload: { ...p, deliveryId },
      });
      return;
    }

    // Only the channels the recipient actually consented to — a consented
    // preferred channel must not fall back onto a refused one.
    const consentedChannels = decision.channels;

    if (!p.deliveryId) {
      await repo.insertDelivery(tx, {
        id: deliveryId, tenantId: msg.tenantId, templateId: effectiveTemplateId,
        recipient: effectiveRecipient, recipientId, channel: consentedChannels[0] ?? preferred, status: "sending",
        retryCount, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
    } else {
      await repo.updateDeliveryStatus(tx, deliveryId, "sending", msg.actorId, retryCount + 1);
    }

    const body = inlineBody ?? template?.body ?? "(no template body)";
    const sendResult = await sendWithFallback(consentedChannels, {
      recipient: effectiveRecipient,
      subject: template?.subject ?? inlineSubject ?? null,
      body,
      tenantId: msg.tenantId,
      userId: recipientId ?? effectiveRecipient,
      ...(p.variables ? { variables: p.variables } : {}),
    });

    if (sendResult.error) {
      const nextRetry = retryCount + 1;
      if (shouldRetry(retryCount)) {
        // P1-2: DURABLE retry. Persist status='queued' + next_retry_at and let the
        // DB-backed sweeper (worker.ts) republish once due. No setTimeout — survives
        // a worker restart because the due row is stored in Postgres.
        const nextRetryAt = computeNextRetryAt(retryCount);
        await repo.scheduleDeliveryRetry(tx, deliveryId, nextRetry, nextRetryAt, msg.actorId, sendResult.error);
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.failed, eventType: EVENTS.failed, tenantId: msg.tenantId,
          actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { deliveryId, retryCount: nextRetry, nextRetryAt: nextRetryAt.toISOString(), recipientId, error: sendResult.error },
        });
        return;
      }

      await repo.updateDeliveryStatus(tx, deliveryId, "failed", msg.actorId, nextRetry + 1, undefined, sendResult.error, sendResult.error);
      await mirrorCampaignOutcome(tx, msg, recipientId, "failed", deliveryId);
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.permanentlyFailed, eventType: EVENTS.permanentlyFailed, tenantId: msg.tenantId,
        actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          deliveryId, templateId: effectiveTemplateId, recipient: effectiveRecipient, recipientId, channel: sendResult.channel,
          retryCount: nextRetry, error: sendResult.error,
        },
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId,
        actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "send", resourceType: "delivery", resourceId: deliveryId,
          outcome: "failure", error: sendResult.error, channel: sendResult.channel,
        },
      });
      return;
    }

    await repo.updateDeliveryStatus(tx, deliveryId, "delivered", msg.actorId, retryCount + 2, new Date(), undefined, undefined, sendResult.channel);
    await mirrorCampaignOutcome(tx, msg, recipientId, "delivered", deliveryId);
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: EVENTS.delivered, eventType: EVENTS.delivered, tenantId: msg.tenantId,
      actorId: msg.actorId, correlationId: msg.correlationId,
      payload: { deliveryId, templateId: effectiveTemplateId, recipient: effectiveRecipient, recipientId, channel: sendResult.channel },
    });
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId,
      actorId: msg.actorId, correlationId: msg.correlationId,
      payload: { service: "notification", action: "send", resourceType: "delivery", resourceId: deliveryId, outcome: "success", recipient: maskRecipient(effectiveRecipient) },
    });
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type GateContext = {
  deliveryId: string;
  hasExistingDelivery: boolean;
  templateId: string;
  recipient: string;
  recipientId: string | null;
  channel: string;
  retryCount: number;
};

/**
 * Terminal refusal: record the delivery as `skipped`, emit the consent-blocked
 * domain event and an audit record, and send nothing. Not retried — a refusal
 * is an answer, not a failure.
 */
async function recordGateSkip(
  tx: Tx,
  msg: CommandEnvelope<SendPayload>,
  ctx: GateContext & { reason: SkipReason },
): Promise<void> {
  if (!ctx.hasExistingDelivery) {
    await repo.insertDelivery(tx, {
      id: ctx.deliveryId, tenantId: msg.tenantId, templateId: ctx.templateId,
      recipient: ctx.recipient, recipientId: ctx.recipientId, channel: ctx.channel,
      status: "skipped", retryCount: ctx.retryCount,
      createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
    });
  } else {
    await repo.updateDeliveryStatus(tx, ctx.deliveryId, "skipped", msg.actorId, ctx.retryCount + 1);
  }
  await mirrorCampaignOutcome(tx, msg, ctx.recipientId, "skipped", ctx.deliveryId);

  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: EVENTS.consentBlocked, eventType: EVENTS.consentBlocked, tenantId: msg.tenantId,
    actorId: msg.actorId, correlationId: msg.correlationId,
    payload: {
      deliveryId: ctx.deliveryId, reason: ctx.reason,
      channel: ctx.channel, recipientId: ctx.recipientId,
    },
  });
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId,
    actorId: msg.actorId, correlationId: msg.correlationId,
    payload: {
      service: "notification", action: "send", resourceType: "delivery", resourceId: ctx.deliveryId,
      outcome: "skipped", channel: ctx.channel, reason: ctx.reason,
      recipient: maskRecipient(ctx.recipient),
    },
  });
}

/**
 * Deferral: park the original command in `dnd.held_notifications` so the DND
 * release sweeper republishes it once the window closes, and leave the delivery
 * `queued` (postponed, not refused) with no retry timestamp.
 */
async function holdForDnd(
  tx: Tx,
  msg: CommandEnvelope<SendPayload>,
  ctx: GateContext & { userId: string | null; releaseAt: Date; payload: SendPayload },
): Promise<void> {
  if (!ctx.hasExistingDelivery) {
    await repo.insertDelivery(tx, {
      id: ctx.deliveryId, tenantId: msg.tenantId, templateId: ctx.templateId,
      recipient: ctx.recipient, recipientId: ctx.recipientId, channel: ctx.channel,
      status: "queued", retryCount: ctx.retryCount,
      createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
    });
  }
  await repo.deferDeliveryForDnd(tx, ctx.deliveryId, msg.actorId, ctx.releaseAt);

  await dndRepo.insertHeldNotification(tx, {
    tenantId: msg.tenantId,
    // A DND window can only exist for a uuid user, so this is non-null here.
    userId: ctx.userId ?? msg.actorId,
    deliveryPayload: ctx.payload,
    holdUntil: ctx.releaseAt,
    status: "held",
  });

  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: EVENTS.dndHeld, eventType: EVENTS.dndHeld, tenantId: msg.tenantId,
    actorId: msg.actorId, correlationId: msg.correlationId,
    payload: {
      deliveryId: ctx.deliveryId, recipientId: ctx.recipientId,
      releaseAt: ctx.releaseAt.toISOString(),
    },
  });
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId,
    actorId: msg.actorId, correlationId: msg.correlationId,
    payload: {
      service: "notification", action: "send", resourceType: "delivery", resourceId: ctx.deliveryId,
      outcome: "held", channel: ctx.channel, reason: "dnd_window",
      releaseAt: ctx.releaseAt.toISOString(),
    },
  });
}

/** Exported for tests — same delay schedule as SQS DelaySeconds [900, 3600, 14400]. */
export { computeNextRetryAt, shouldRetry } from "./retry.js";
export { retryDelaySeconds } from "./retry.js";
