/**
 * events/consumer.ts — CDP-003 handler for cdp.event.ingest_batch.
 *
 * This is the only cdp write path that is genuinely asynchronous: POST
 * /v1/cdp/events/ingest-batch validates and publishes one command per event and never
 * touches the database, so without this consumer an accepted event was silently dropped.
 * The synchronous sibling (POST /v1/cdp/events) still writes inline; the two must not be
 * confused, and nothing here re-does work the route already did.
 */
import type { CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import { validateConsent } from "./domain.js";

const log = pino({ name: "cdp-events-consumer", level: process.env.LOG_LEVEL ?? "info" });

const AUDIT_TOPIC = "audit.event.record";

/**
 * Re-validated on the way in even though the route validated on the way out: a message
 * can outlive the code that published it, and a shape mismatch must be a logged skip
 * rather than an exception that redelivers forever.
 */
const payloadSchema = z.object({
  profileId: z.string().uuid(),
  eventType: z.string().min(1).max(128),
  payload: z.record(z.unknown()).default({}),
  occurredAt: z.string().datetime(),
  source: z.string().min(1).max(64).optional(),
});

export type IngestEventBatchPayload = z.infer<typeof payloadSchema>;

export async function handleIngestEventBatch(msg: CommandEnvelope<unknown>): Promise<void> {
  const parsed = payloadSchema.safeParse(msg.payload);
  if (!parsed.success) {
    // No event id to report — the payload is what failed. Issue paths only, never values:
    // an event payload can carry anything the collector observed.
    log.warn(
      { messageId: msg.messageId, tenantId: msg.tenantId, outcome: "skipped_invalid_payload", issues: parsed.error.issues.map((i) => i.path.join(".")) },
      "ingest_batch payload rejected",
    );
    return;
  }
  const p = parsed.data;

  const profile = await profilesRepo.findById(p.profileId, msg.tenantId);
  if (!profile || profile.profileType === "merged") {
    log.warn(
      { messageId: msg.messageId, tenantId: msg.tenantId, profileId: p.profileId, outcome: "skipped_unknown_profile" },
      "ingest_batch profile not found",
    );
    return;
  }

  // Same consent gate as the synchronous route. Consent can be withdrawn between publish
  // and consume, and the later of the two checks is the one that must win.
  const consentFlags = profile.attributes.consent as Record<string, boolean> | undefined;
  const consent = validateConsent(p.eventType, consentFlags);
  if (!consent.allowed) {
    log.info(
      { messageId: msg.messageId, tenantId: msg.tenantId, profileId: p.profileId, eventType: p.eventType, outcome: "skipped_consent_denied" },
      "ingest_batch consent denied",
    );
    return;
  }

  const eventId = randomUUID();
  let written = false;

  await db.transaction(async (tx) => {
    // Idempotency gate — first statement in the transaction. A redelivery of the same
    // messageId must not add a second row to an append-only event store.
    const fresh = await markProcessed(tx, msg.messageId);
    if (!fresh) return;

    await repo.insert(tx, {
      id: eventId,
      tenantId: msg.tenantId,
      profileId: p.profileId,
      eventType: p.eventType,
      payload: p.payload,
      occurredAt: new Date(p.occurredAt),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await enqueue(tx, {
      topic: EVENTS.eventIngested,
      eventType: EVENTS.eventIngested,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        eventId,
        profileId: p.profileId,
        eventType: p.eventType,
        ...(p.source !== undefined ? { source: p.source } : {}),
      },
    });

    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        service: "cdp",
        action: "event_ingested_async",
        resourceType: "event_store",
        resourceId: eventId,
        outcome: "success",
        // Deliberately no event payload: it is arbitrary collector data.
        metadata: { profileId: p.profileId, eventType: p.eventType, source: p.source ?? null },
      },
    });

    written = true;
  });

  if (!written) {
    log.debug({ messageId: msg.messageId, outcome: "duplicate" }, "ingest_batch redelivery skipped");
    return;
  }

  // After the commit: a missed invalidation self-heals via the bounded TTL, whereas
  // invalidating inside the transaction can publish a miss for a write that rolls back.
  await cache.invalidate(cache.makeKey(msg.tenantId, "profile_summary", p.profileId));
  log.info(
    { messageId: msg.messageId, tenantId: msg.tenantId, profileId: p.profileId, eventId, outcome: "processed" },
    "ingest_batch event stored",
  );
}
