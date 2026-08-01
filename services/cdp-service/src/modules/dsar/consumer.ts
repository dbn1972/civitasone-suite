/**
 * dsar/consumer.ts — CDP-011 handler for cdp.dsar.raise.
 *
 * POST /v1/cdp/dsar writes the register row synchronously (a statutory clock cannot start
 * on a message still in flight) and that row is not rewritten here. What this handler does
 * is the fulfilment work the route explicitly defers: move the request into `in_progress`
 * and purge the cdp-owned data the request covers.
 *
 * Scope of the purge, per DPDP Act 2023 §§11-13:
 *  - erasure       → revoke device tokens, drop identifier edges, drop audience memberships
 *  - rectification → drop audience memberships only (the values are being corrected, not
 *                    removed, but a stale audience must stop being activated meanwhile)
 *  - access / portability → nothing is destroyed; these are read-only disclosures
 *
 * The profile row itself is left for the steward's POST /dsar/:id/complete: closing the
 * register is a human decision, and `cdp.dsar.completed` is what tells other services to
 * purge their own copies.
 */
import type { CommandEnvelope } from "@civitasone/queue";
import { z } from "zod";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as deviceRepo from "../identity/device-repo.js";
import * as identityRepo from "../identity/repo.js";
import * as membershipRepo from "../segments/membership-repo.js";
import { DSAR_REQUEST_TYPES, requiresDownstreamPurge } from "./domain.js";

const log = pino({ name: "cdp-dsar-consumer", level: process.env.LOG_LEVEL ?? "info" });

const AUDIT_TOPIC = "audit.event.record";

const payloadSchema = z.object({
  dsarId: z.string().uuid(),
  profileId: z.string().uuid(),
  requestType: z.enum(DSAR_REQUEST_TYPES),
});

export type RaiseDsarPayload = z.infer<typeof payloadSchema>;

export interface PurgeCounts {
  deviceTokens: number;
  identityLinks: number;
  memberships: number;
}

export async function handleRaiseDsar(msg: CommandEnvelope<unknown>): Promise<void> {
  const parsed = payloadSchema.safeParse(msg.payload);
  if (!parsed.success) {
    log.warn(
      { messageId: msg.messageId, tenantId: msg.tenantId, outcome: "skipped_invalid_payload", issues: parsed.error.issues.map((i) => i.path.join(".")) },
      "dsar payload rejected",
    );
    return;
  }
  const p = parsed.data;

  const request = await repo.findById(p.dsarId, msg.tenantId);
  if (!request) {
    log.warn(
      { messageId: msg.messageId, tenantId: msg.tenantId, dsarId: p.dsarId, outcome: "skipped_unknown_request" },
      "dsar request not found",
    );
    return;
  }
  // Only a freshly raised request is fulfilled here. Anything else has already been picked
  // up (or discharged) and re-running the purge would emit a second fulfilment event.
  if (request.status !== "pending") {
    log.info(
      { messageId: msg.messageId, tenantId: msg.tenantId, dsarId: p.dsarId, status: request.status, outcome: "skipped_not_pending" },
      "dsar request already progressed",
    );
    return;
  }

  const purged: PurgeCounts = { deviceTokens: 0, identityLinks: 0, memberships: 0 };
  let started = false;

  await db.transaction(async (tx) => {
    // Idempotency gate — first statement. The purge below is destructive; a redelivery
    // must not run it again against whatever has been re-linked since.
    const fresh = await markProcessed(tx, msg.messageId);
    if (!fresh) return;

    const ok = await repo.startProcessing(tx, p.dsarId, msg.tenantId, request.version);
    if (!ok) {
      // A concurrent writer advanced the request. Purging without owning the transition
      // would destroy data outside any recorded state change.
      return;
    }

    if (p.requestType === "erasure") {
      purged.deviceTokens = await deviceRepo.deleteByProfile(tx, p.profileId, msg.tenantId);
      purged.identityLinks = await identityRepo.deleteByProfile(tx, p.profileId, msg.tenantId);
    }
    if (requiresDownstreamPurge(p.requestType)) {
      purged.memberships = await membershipRepo.deleteByProfile(tx, p.profileId, msg.tenantId);
    }

    await enqueue(tx, {
      topic: EVENTS.dsarInProgress,
      eventType: EVENTS.dsarInProgress,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        dsarId: p.dsarId,
        profileId: p.profileId,
        requestType: p.requestType,
        status: "in_progress",
        purgeDownstream: requiresDownstreamPurge(p.requestType),
        purged: { ...purged },
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
        action: "dsar_fulfilment_started",
        resourceType: "dsar_request",
        resourceId: p.dsarId,
        outcome: "success",
        metadata: { profileId: p.profileId, requestType: p.requestType, purged: { ...purged } },
      },
    });

    started = true;
  });

  if (started) {
    // Device and segment counts feed the summary projection, and the lineage/profile reads
    // are served from the same tenant namespace — all invalidated after the commit.
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile_summary", p.profileId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile", p.profileId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile_lineage", p.profileId));
  }

  log.info(
    {
      messageId: msg.messageId,
      tenantId: msg.tenantId,
      dsarId: p.dsarId,
      profileId: p.profileId,
      requestType: p.requestType,
      purged,
      outcome: started ? "processed" : "skipped_conflict_or_duplicate",
    },
    "dsar fulfilment handled",
  );
}
