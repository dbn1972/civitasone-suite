/**
 * visitor-service: blacklist / watchlist consumer.
 *
 * Handles `COMMANDS.blacklistAdd` / `COMMANDS.blacklistApprove` /
 * `COMMANDS.blacklistDeactivate` / `COMMANDS.watchlistAdd`:
 *   markProcessed(tx, msg.messageId) -> insert/update `blacklist_entries` /
 *   `watchlist_entries` (via modules/blacklist/domain.ts's state machine and
 *   maker-checker guard) -> sync the Redis screening hash sets
 *   `visitor:{tid}:blacklist:hashes` / `visitor:{tid}:watchlist:hashes`
 *   (modules/blacklist/screening-store.ts) after commit.
 *
 * `commands.ts` mints the entry's `id` (uuid) BEFORE publishing and returns
 * it to the caller as the 202 Accepted `id` — this consumer MUST insert
 * with that exact `id` (never let the DB default-generate a new one), or
 * the id returned to the client at request time would not match the
 * eventually-persisted row.
 *
 * Outbox events (`EVENTS.blacklistMatched` / `watchlistMatched` /
 * `securityIncidentCreated`) are intentionally NOT emitted from this
 * consumer — per design.md, those fire at actual screening-hit time (i.e.
 * when a visit request's identity is checked against these hash sets in
 * `modules/visit-request/routes.ts`/`consumer.ts`, Task 6.10/6.11), not
 * when a blacklist/watchlist entry is created or approved.
 *
 * Graceful degradation (steering "Error Handling & Resilience"): the Redis
 * hash-set sync happens AFTER the DB transaction commits. A sync failure
 * (e.g. Redis down) is caught, logged at WARN (not ERROR), and does NOT
 * fail the message — the blacklist/watchlist row has already been durably
 * recorded in Postgres, and the screening set is a best-effort mirror that
 * can be re-synced (a future full-resync job, or the next add/approve for
 * that tenant).
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { blacklistEntries, watchlistEntries } from "./schema.js";
import { assertBlacklistTransition, assertDistinctMakerChecker, normalizeName } from "./domain.js";
import { addToBlacklistHashSet, addToWatchlistHashSet, removeFromBlacklistHashSet } from "./screening-store.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "blacklist-consumer" });

export interface BlacklistAddPayload {
  id: string;
  tenantId: string;
  locationId?: string | null;
  personName: string;
  identityDocType?: string | null;
  identityDocHash?: string | null;
  reason: string;
  effectiveFrom?: string | null;
  expiresAt?: string | null;
}

export interface BlacklistApprovePayload {
  id: string;
  tenantId: string;
}

export interface BlacklistDeactivatePayload {
  id: string;
  tenantId: string;
}

export interface WatchlistAddPayload {
  id: string;
  tenantId: string;
  locationId?: string | null;
  personName: string;
  identityDocType?: string | null;
  identityDocHash?: string | null;
  riskLevel?: "low" | "medium" | "high";
  specialInstructions?: string | null;
}

interface ApprovedEntry {
  identityDocHash: string | null;
  expiresAt: Date | null;
}

interface DeactivatedEntry {
  identityDocHash: string | null;
}

export function registerBlacklistConsumers(queue: Queue): void {
  queue.subscribe<BlacklistAddPayload>(COMMANDS.blacklistAdd, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      await tx.insert(blacklistEntries).values({
        id: p.id,
        tenantId: msg.tenantId,
        locationId: p.locationId ?? null,
        personName: p.personName,
        nameNormalized: normalizeName(p.personName),
        identityDocType: p.identityDocType ?? null,
        identityDocHash: p.identityDocHash ?? null,
        reason: p.reason,
        ...(p.effectiveFrom ? { effectiveFrom: new Date(p.effectiveFrom) } : {}),
        expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "blacklist", resourceId: p.id, outcome: "success" } });
    });
  });

  queue.subscribe<BlacklistApprovePayload>(COMMANDS.blacklistApprove, async (msg) => {
    const p = msg.payload;

    const approved: ApprovedEntry | null = await db.transaction(async (tx): Promise<ApprovedEntry | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay

      const rows = await tx
        .select()
        .from(blacklistEntries)
        .where(and(eq(blacklistEntries.id, p.id), eq(blacklistEntries.tenantId, msg.tenantId)))
        .limit(1);
      const entry = rows[0];
      if (!entry) {
        throw new Error(`blacklist entry '${p.id}' not found for tenant '${msg.tenantId}'`);
      }

      // Property 18: maker-checker — approver must differ from creator.
      assertDistinctMakerChecker(entry.createdBy, msg.actorId);
      assertBlacklistTransition(entry.status, "active");

      await tx
        .update(blacklistEntries)
        .set({
          status: "active",
          approvedBy: msg.actorId,
          approvedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        })
        .where(and(eq(blacklistEntries.id, p.id), eq(blacklistEntries.tenantId, msg.tenantId)));
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "blacklist", resourceId: p.id, outcome: "success" } });

      return { identityDocHash: entry.identityDocHash, expiresAt: entry.expiresAt };
    });

    if (!approved) return; // already processed (idempotent replay)

    // Requirement 10.4/10.6 — sync the screening hash set so subsequent
    // visit-request SISMEMBER checks (Task 6.10) see the newly-active entry.
    // Fix 3: the entry's expiresAt now travels with it into the screening
    // set (screening-store.ts#addToBlacklistHashSet), so isBlacklisted()
    // can stop honouring the block once it lapses instead of blocking
    // forever regardless of the approving officer's stated expiry.
    // Best-effort: never fail an already-committed approval because Redis
    // is unavailable.
    if (approved.identityDocHash) {
      try {
        await addToBlacklistHashSet(msg.tenantId, approved.identityDocHash, approved.expiresAt);
      } catch (err) {
        log.warn(
          { err, tenantId: msg.tenantId, entryId: p.id, event: "blacklist_hash_sync_failed" },
          "blacklist screening hash-set sync failed; entry already approved, set will self-heal on next add/approve",
        );
      }
    }
  });

  // Fix 3: lifts an active blacklist entry (transitions active -> archived)
  // and removes it from the live screening set. Before this handler
  // existed, there was NO way to release a block once granted — topics.ts
  // only defined blacklistAdd/blacklistApprove. Same maker-checker rigor
  // as blacklistApprove: the deactivating actor must differ from the
  // entry's original creator (Property 18 applies symmetrically).
  queue.subscribe<BlacklistDeactivatePayload>(COMMANDS.blacklistDeactivate, async (msg) => {
    const p = msg.payload;

    const deactivated: DeactivatedEntry | null = await db.transaction(async (tx): Promise<DeactivatedEntry | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay

      const rows = await tx
        .select()
        .from(blacklistEntries)
        .where(and(eq(blacklistEntries.id, p.id), eq(blacklistEntries.tenantId, msg.tenantId)))
        .limit(1);
      const entry = rows[0];
      if (!entry) {
        throw new Error(`blacklist entry '${p.id}' not found for tenant '${msg.tenantId}'`);
      }

      // Property 18 (segregation of duties, symmetric with blacklistApprove):
      // the actor lifting a block must differ from the actor who created it.
      assertDistinctMakerChecker(entry.createdBy, msg.actorId);
      assertBlacklistTransition(entry.status, "archived");

      await tx
        .update(blacklistEntries)
        .set({
          status: "archived",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        })
        .where(and(eq(blacklistEntries.id, p.id), eq(blacklistEntries.tenantId, msg.tenantId)));
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "blacklist", resourceId: p.id, outcome: "success" } });
      await enqueue(tx, {
        topic: EVENTS.blacklistDeactivated,
        eventType: EVENTS.blacklistDeactivated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId, deactivatedAt: new Date().toISOString() },
      });

      return { identityDocHash: entry.identityDocHash };
    });

    if (!deactivated) return; // already processed (idempotent replay)

    // Take effect immediately — don't wait for isBlacklisted()'s lazy
    // expiry eviction, since this entry has no expiresAt-driven lapse at
    // all (it may well be a permanent entry being manually lifted).
    if (deactivated.identityDocHash) {
      try {
        await removeFromBlacklistHashSet(msg.tenantId, deactivated.identityDocHash);
      } catch (err) {
        log.warn(
          { err, tenantId: msg.tenantId, entryId: p.id, event: "blacklist_hash_desync_failed" },
          "blacklist screening hash-set removal failed; entry already archived in DB, set will self-heal on next add/approve/deactivate",
        );
      }
    }
  });

  queue.subscribe<WatchlistAddPayload>(COMMANDS.watchlistAdd, async (msg) => {
    const p = msg.payload;

    const inserted = await db.transaction(async (tx): Promise<boolean> => {
      if (!(await markProcessed(tx, msg.messageId))) return false; // idempotent replay

      // Requirement 10.5 — watchlist entries are active immediately, no
      // maker-checker required.
      await tx.insert(watchlistEntries).values({
        id: p.id,
        tenantId: msg.tenantId,
        locationId: p.locationId ?? null,
        personName: p.personName,
        nameNormalized: normalizeName(p.personName),
        identityDocType: p.identityDocType ?? null,
        identityDocHash: p.identityDocHash ?? null,
        riskLevel: p.riskLevel ?? "medium",
        specialInstructions: p.specialInstructions ?? null,
        active: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "blacklist", resourceId: p.id, outcome: "success" } });

      return true;
    });

    if (!inserted) return; // already processed (idempotent replay)

    // Requirement 10.5 — sync the watchlist screening hash set. Best-effort,
    // same rationale as the blacklist approval path above.
    if (p.identityDocHash) {
      try {
        await addToWatchlistHashSet(msg.tenantId, p.identityDocHash);
      } catch (err) {
        log.warn(
          { err, tenantId: msg.tenantId, entryId: p.id, event: "watchlist_hash_sync_failed" },
          "watchlist screening hash-set sync failed; entry already created, set will self-heal on next add",
        );
      }
    }
  });
}
