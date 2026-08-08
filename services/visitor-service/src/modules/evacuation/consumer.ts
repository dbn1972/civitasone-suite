/**
 * visitor-service: evacuation consumer.
 *
 * Handles `COMMANDS.evacuationDeclare` / `COMMANDS.evacuationMarkSafe`:
 *
 * evacuationDeclare:
 *   markProcessed(tx, msg.messageId) → fetch full roster via
 *   `getFullRoster(tenantId, locationId)` → for each roster contact,
 *   enqueue `NOTIFICATION_SEND` (bulk SMS with evacuation alert) →
 *   outbox `evacuationDeclared` event (Requirement 17.4).
 *
 * evacuationMarkSafe:
 *   markProcessed(tx, msg.messageId) → update roster entry's `evacuated`
 *   flag to true (via addToRoster overwrite) → compute completion
 *   percentage (evacuated / total) → if 100%, outbox
 *   `evacuationCompleted` (Requirement 17.5).
 *
 * Follows the CQRS consumer pattern from modules/blacklist/consumer.ts.
 *
 * Graceful degradation: roster operations happen AFTER the DB transaction
 * commits (outbox/idempotency). A Redis failure updating the evacuated
 * flag is caught, logged at WARN, and does NOT fail the message — the
 * mark-safe intention is idempotently recorded via markProcessed and the
 * roster is a best-effort ephemeral mirror.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { getFullRoster, addToRoster, type RosterEntry } from "./roster.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "evacuation-consumer" });

// ── Payload Types ────────────────────────────────────────────────────────

export interface EvacuationDeclarePayload {
  id: string;
  tenantId: string;
  locationId: string;
  reason: string | null;
}

export interface EvacuationMarkSafePayload {
  tenantId: string;
  locationId: string;
  passId: string;
}

// ── Consumer Registration ────────────────────────────────────────────────

export function registerEvacuationConsumers(queue: Queue): void {
  // ─── evacuationDeclare ───────────────────────────────────────────────
  queue.subscribe<EvacuationDeclarePayload>(COMMANDS.evacuationDeclare, async (msg) => {
    const p = msg.payload;

    // Fetch the full roster BEFORE the transaction so we know who to SMS.
    // The roster is an ephemeral Redis structure — not transactional.
    const roster = await getFullRoster(p.tenantId, p.locationId);

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Bulk SMS to every roster contact (Requirement 17.4)
      for (const entry of roster) {
        if (entry.contactNumber) {
          await enqueue(tx, {
            topic: NOTIFICATION_SEND,
            eventType: EVENTS.evacuationDeclared,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: buildNotificationPayload({
              eventType: EVENTS.evacuationDeclared,
              recipient: entry.contactNumber,
              channel: "sms",
              variables: {
                visitorName: entry.visitorName,
                locationId: p.locationId,
                reason: p.reason ?? "Emergency evacuation declared",
              },
            }),
          });
        }
      }

      // Outbox: evacuationDeclared event
      await enqueue(tx, {
        topic: EVENTS.evacuationDeclared,
        eventType: EVENTS.evacuationDeclared,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          locationId: p.locationId,
          reason: p.reason,
          rosterCount: roster.length,
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "evacuation", resourceId: p.id, outcome: "success" } });
    });
  });

  // ─── evacuationMarkSafe ──────────────────────────────────────────────
  queue.subscribe<EvacuationMarkSafePayload>(COMMANDS.evacuationMarkSafe, async (msg) => {
    const p = msg.payload;

    const result = await db.transaction(async (tx): Promise<{ completionPct: number; totalCount: number; evacuatedCount: number } | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay
      // Return a placeholder — actual roster update happens post-commit
      // since the roster is an ephemeral Redis mirror (not transactional).
      return { completionPct: 0, totalCount: 0, evacuatedCount: 0 };
    });

    if (!result) return; // already processed (idempotent replay)

    // Update roster entry's evacuated flag (post-commit, best-effort).
    // Fetch the full roster to find the entry and compute completion.
    try {
      const roster = await getFullRoster(p.tenantId, p.locationId);
      const entry = roster.find((e) => e.passId === p.passId);

      if (entry) {
        // Overwrite the entry with evacuated = true
        const updated: RosterEntry = { ...entry, evacuated: true };
        await addToRoster(p.tenantId, p.locationId, updated);
      }

      // Re-fetch roster to compute completion percentage
      const updatedRoster = await getFullRoster(p.tenantId, p.locationId);
      const totalCount = updatedRoster.length;
      const evacuatedCount = updatedRoster.filter((e) => e.evacuated).length;
      const completionPct = totalCount > 0 ? Math.round((evacuatedCount / totalCount) * 100) : 100;

      // If 100% evacuated → outbox evacuationCompleted (Requirement 17.5)
      if (completionPct === 100 && totalCount > 0) {
        await db.transaction(async (tx): Promise<void> => {
          await enqueue(tx, {
            topic: EVENTS.evacuationCompleted,
            eventType: EVENTS.evacuationCompleted,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              locationId: p.locationId,
              totalCount,
              evacuatedCount,
              completionPct,
            },
          });
        });
      }
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, locationId: p.locationId, passId: p.passId, event: "evacuation_mark_safe_roster_update_failed" },
        "evacuation roster mark-safe update failed; idempotency already recorded, roster will self-heal on next operation",
      );
    }
  });
}
