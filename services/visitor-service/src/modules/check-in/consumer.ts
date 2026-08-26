/**
 * visitor-service: check-in / check-out / overstay-detect consumer.
 *
 * Handles `COMMANDS.checkInRecord` / `COMMANDS.checkOutRecord` / `COMMANDS.overstayDetect`:
 *   markProcessed(tx, msg.messageId) -> insert `check_ins` row -> transition
 *   the digital pass's `status` (via modules/check-in/domain.ts's
 *   checkIn/checkOut state machine) -> capacity-threshold check (Property 28)
 *   -> outbox `visitorCheckedIn`/`visitorCheckedOut`/`overstayAlerted` ->
 *   evacuation roster add/remove -> NOTIFICATION_SEND to host (arrival) and
 *   security control room (watchlist match).
 *
 * Requirements covered: 5.3, 5.5, 5.7, 6.1, 6.2, 6.3, 6.4, 19.5
 *
 * Roster wiring / graceful degradation (per roster.ts's module doc and
 * steering "Error Handling & Resilience — Graceful degradation"): the
 * roster call happens AFTER the DB transaction commits. A roster failure
 * (e.g. Redis down) is caught, logged at WARN (not ERROR), and does NOT
 * fail the message — the check-in/check-out has already been durably
 * recorded in Postgres, and the roster is a best-effort ephemeral mirror
 * that self-heals on the next check-in/out. Retrying/redelivering the
 * message for a roster-only failure would be a needless DLQ risk for
 * state that already committed.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { and, eq, lt } from "drizzle-orm";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { notifyVipArrival } from "../vip/routes.js";
import { getPolicyBoolean } from "../config-registry/policy.js";
import { checkIns } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { visitRequests, type VisitRequestRow } from "../visit-request/schema.js";
import { locations, gates } from "../location/schema.js";
import { devices } from "../device-registry/schema.js";
import { securityIncidents } from "../identity/schema.js";
import {
  checkIn as domainCheckIn,
  checkOut as domainCheckOut,
  isLocationScopeValid,
  isAreaPermitted,
  type CheckInStatus,
} from "./domain.js";
import { assertWithinCapacity, isOverCapacityThreshold } from "../location/domain.js";
import { addToRoster, removeFromRoster, getVisitorCount, type RosterEntry } from "../evacuation/roster.js";
import { isBlacklisted, isWatchlisted } from "../blacklist/screening-store.js";
import { identityDocHash } from "../blacklist/blind-index.js";
import { isRevoked } from "../digital-pass/revocation-store.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "check-in-consumer" });

interface CheckInRecordPayload {
  checkInId?: string;
  passId: string;
  gateId: string;
  gateTerminalId?: string;
  offlineRecorded?: boolean;
  verificationMethod?: string;
  timestamp?: string; // ISO — falls back to now() when absent (e.g. offline sync catch-up)
}

interface CheckOutRecordPayload {
  checkOutId?: string;
  passId: string;
  gateId: string;
  gateTerminalId?: string;
  offlineRecorded?: boolean;
  verificationMethod?: string;
  timestamp?: string;
}

interface CommittedCheckIn {
  locationId: string;
  visitorName: string;
  hostName: string;
  hostEmployeeId: string;
  contactNumber: string;
  checkInTime: string;
  identityDocHash: string | null;
  capacityThreshold: number | null;
}

interface CommittedCheckOut {
  locationId: string;
}

interface OvrstayDetectPayload {
  /** Optional ISO timestamp; defaults to now() if absent. */
  asOf?: string;
  /** Optional location scope — when set, only checks passes at this location. */
  locationId?: string;
}

/** Payload shape published by document-scan/consumer.ts on a confirmed blacklist match. */
interface ScanBlacklistMatchPayload {
  sessionId: string;
  ocrResultId: string;
  deviceId: string;
  idDocumentType?: string | null;
}

export function registerCheckInConsumers(queue: Queue): void {
  queue.subscribe<CheckInRecordPayload>(COMMANDS.checkInRecord, async (msg) => {
    const p = msg.payload;

    const committed: CommittedCheckIn | null = await db.transaction(async (tx): Promise<CommittedCheckIn | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null;

      const passRows = await tx
        .select()
        .from(digitalPasses)
        .where(and(eq(digitalPasses.id, p.passId), eq(digitalPasses.tenantId, msg.tenantId)))
        .limit(1);
      const pass = passRows[0];
      if (!pass) {
        throw new Error(`digital pass '${p.passId}' not found for tenant '${msg.tenantId}'`);
      }

      // SECURITY FIX (gate/location/area scope bypass): the synchronous
      // /passes/verify endpoint (check-in/routes.ts) enforces Property 26
      // (isLocationScopeValid) and Property 19 (isAreaPermitted) before ever
      // returning "valid" — but this consumer, which is what actually
      // COMMITS the check-in, previously trusted a bare {passId, gateId}
      // completely: no gate lookup, no location/area comparison. Reachable
      // by the broad "employee" role (check-in/routes.ts's WRITE_ROLES), not
      // only a gate_terminal device identity, a caller could check in any
      // pass at any gate string, including one matching no real gate row at
      // all. Fail closed: dead-letter (NonRetryableError, matching this
      // codebase's convention — see config-registry/consumer.ts) rather than
      // silently committing a scope-violating check-in. checkInRecord's
      // payload carries no QR token to re-verify a signature against (that
      // already happened at /passes/verify); the gate/location/area scope is
      // the part of Property 9 this write path CAN and now does re-assert.
      const gateRows = await tx
        .select()
        .from(gates)
        .where(and(eq(gates.id, p.gateId), eq(gates.tenantId, msg.tenantId)))
        .limit(1);
      const gate = gateRows[0];
      if (!gate) {
        throw new NonRetryableError(`gate '${p.gateId}' not found for tenant '${msg.tenantId}'`);
      }
      if (!isLocationScopeValid(pass.locationId, gate.locationId)) {
        throw new NonRetryableError(
          `pass '${p.passId}' is scoped to location '${pass.locationId}', not gate location '${gate.locationId}'`,
        );
      }
      if (!isAreaPermitted(gate.areaId, pass.permittedAreas as string[])) {
        throw new NonRetryableError(
          `gate '${p.gateId}' area '${gate.areaId ?? "(perimeter)"}' is not among pass '${p.passId}''s permitted areas`,
        );
      }

      // SECURITY FIX (revocation bypass at commit time): the synchronous
      // /passes/verify endpoint (check-in/routes.ts) enforces Property 9
      // condition (b) isRevoked before ever returning "valid" — but,
      // exactly like the gate/location/area scope above before that fix,
      // this consumer referenced neither isRevoked nor pass.revoked at
      // all. A DIRECTLY-revoked pass (digital-pass/consumer.ts's
      // passRevoke handler) happens to also flip digitalPasses.status to
      // "revoked", which domainCheckIn (below) rejects via
      // INVALID_TRANSITION — but a suspended/revoked recurring pass
      // (recurring-pass/consumer.ts's suspend/revoke handlers) never
      // touches digitalPasses.status at all; it only dual-writes into
      // this same Redis revocation set (see commit 25949e30,
      // "recurring-pass revocation now blocks at the gate") — a write
      // that "only matters if something at commit time reads it", and
      // nothing did. POST /v1/visitor/check-ins (check-in/routes.ts)
      // publishes checkInRecord straight from {passId, gateId} with no
      // precondition that /passes/verify was ever called, reachable by
      // the broad "employee" role — so an employee-role caller who knows
      // a passId+gateId could check in a revoked pass by hitting this
      // endpoint directly, skipping verify entirely. Fail closed:
      // NonRetryableError, the same convention the scope check above
      // established for this exact commit path.
      if (await isRevoked(msg.tenantId, p.passId)) {
        throw new NonRetryableError(`pass '${p.passId}' has been revoked`);
      }

      // Visit request is loaded here (rather than later, as it was before)
      // so the identity/blacklist gate below can run BEFORE any check-in
      // side effect is written.
      const visitRows = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, pass.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)))
        .limit(1);
      const visit: VisitRequestRow | undefined = visitRows[0];

      // Identity-verification / blacklist gate. Previously a failed
      // DigiLocker/Aadhaar verification (identity/consumer.ts) or a
      // document-scan blacklist match (document-scan/consumer.ts) only
      // ever logged an event for a human to notice later — nothing
      // stopped the visit from being checked in. Two conditions block:
      //
      // 1. identityMethod is a REAL verification method ("digilocker" /
      //    "aadhaar_face") AND identityVerified is still false. This
      //    specifically means "a verification was attempted and did not
      //    succeed" — NOT "verification was never required for this
      //    visit" (identityMethod null/"none") and NOT "service was
      //    unavailable, guard verifies manually" (identityMethod
      //    "manual", a sanctioned degraded path). Blocking on bare
      //    `identityVerified === false` would also block every visit that
      //    never uses digital identity verification at all (the common
      //    case), so that distinction matters.
      // 2. The visit's own identity document hash is present in the
      //    canonical blacklist screening set (the same
      //    `visitor:{tid}:blacklist:hashes` set document-scan now
      //    correctly screens against — see modules/blacklist/
      //    screening-store.ts). This independently catches a blacklist
      //    match regardless of whether a document-scan actually ran for
      //    this visit, as long as the visit's own identityDocRef is the
      //    blacklisted document. identityDocRef is an encryptedText()
      //    column (visit-request/schema.ts) — DPDP ciphertext at rest,
      //    but transparently decrypted on read — so it MUST be rehashed
      //    via identityDocHash() before ever reaching isBlacklisted,
      //    never compared/forwarded raw (see
      //    tests/check-in-watchlist-consumer-hash.test.ts for the
      //    separate, now-fixed bug this same mistake caused elsewhere in
      //    this handler).
      //
      // Non-retryable: retrying will never make a failed verification or
      // an active blacklist match go away.
      if (visit) {
        const attemptedRealVerification =
          visit.identityMethod === "digilocker" || visit.identityMethod === "aadhaar_face";
        if (attemptedRealVerification && !visit.identityVerified) {
          throw new NonRetryableError(
            `visit request '${visit.id}' failed identity verification (method=${visit.identityMethod}) — refusing check-in for pass '${p.passId}'`,
          );
        }

        if (visit.identityDocRef) {
          const docHash = identityDocHash(visit.identityDocRef, visit.identityDocType);
          if (await isBlacklisted(msg.tenantId, docHash)) {
            throw new NonRetryableError(
              `visit request '${visit.id}' identity document is blacklisted — refusing check-in for pass '${p.passId}'`,
            );
          }
        }
      }

      const nextStatus = domainCheckIn(pass.status as CheckInStatus, { passType: pass.passType as never });

      const timestamp = p.timestamp ? new Date(p.timestamp) : new Date();

      await tx.insert(checkIns).values({
        tenantId: msg.tenantId,
        passId: p.passId,
        locationId: pass.locationId,
        gateId: p.gateId,
        direction: "in",
        timestamp,
        ...(p.gateTerminalId !== undefined ? { gateTerminalId: p.gateTerminalId } : {}),
        offlineRecorded: p.offlineRecorded ?? false,
        verificationMethod: p.verificationMethod ?? "qr",
        createdBy: msg.actorId,
      });

      await tx
        .update(digitalPasses)
        .set({ status: nextStatus, updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(digitalPasses.id, p.passId), eq(digitalPasses.tenantId, msg.tenantId)));

      // visit was already loaded above (before the identity/blacklist gate).

      await enqueue(tx, {
        topic: EVENTS.visitorCheckedIn,
        eventType: EVENTS.visitorCheckedIn,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { passId: p.passId, locationId: pass.locationId, gateId: p.gateId, timestamp: timestamp.toISOString() },
      });

      // Requirement 19.5 / Property 28: capacity-threshold ENFORCEMENT, before
      // this check-in commits. `assertWithinCapacity` (the throwing/
      // enforcing variant in modules/location/domain.ts) previously sat
      // dead code — only the boolean isOverCapacityThreshold was consulted,
      // and only AFTER commit (see the post-commit block below), purely to
      // fire an alert. That contradicted assertWithinCapacity's own doc
      // comment ("reject new check-ins while the location is at/over its
      // configured capacity threshold"). Throwing here rolls back this
      // entire transaction (checkIns insert + digitalPasses status update
      // included), so a location at/over capacityThreshold now actually
      // blocks the new check-in instead of merely alerting after admitting
      // it.
      //
      // Judgment call: `occupancy` is the roster count BEFORE this visitor
      // is added (addToRoster runs after commit, per this module's
      // graceful-degradation contract) — the SAME value this handler always
      // computed for the post-commit alert below. Reusing that (rather than
      // occupancy + 1, i.e. "would admitting this visitor reach the
      // threshold") keeps a configured capacityThreshold meaning what the
      // alert already established it to mean at this call site: the Nth
      // concurrent occupant is admitted and the (N+1)th is turned away, not
      // the (N-1)th. If the intended UX is actually the stricter "occupancy
      // must never reach capacityThreshold at all" reading of
      // assertWithinCapacity's own doc comment, this is the call to change
      // (pass occupancy + 1 instead) — flagging that ambiguity plainly since
      // it's a real behavioral choice, not just a wiring detail.
      //
      // Residual race: this read isn't lock-protected (getVisitorCount is a
      // Redis call, not part of this Postgres transaction), and
      // addToRoster for THIS visitor doesn't happen until after commit — so
      // two check-ins at the same location, right at the threshold, can
      // still both read the same pre-add occupancy and both be admitted.
      // The post-commit alert below remains as a backstop notification for
      // that case; closing the race itself would need atomic Redis
      // check-and-incr or moving occupancy accounting into this
      // transaction, out of scope for this fix.
      const locationRows = await tx
        .select({ capacityThreshold: locations.capacityThreshold })
        .from(locations)
        .where(and(eq(locations.id, pass.locationId), eq(locations.tenantId, msg.tenantId)))
        .limit(1);
      const location = locationRows[0];

      if (location?.capacityThreshold != null) {
        const occupancy = await getVisitorCount(msg.tenantId, pass.locationId);
        assertWithinCapacity(occupancy, location.capacityThreshold);
      }

      // Requirement 5.5: NOTIFICATION_SEND to host on visitor arrival (push)
      if (visit?.hostEmployeeId) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitorCheckedIn,
            recipientId: visit.hostEmployeeId,
            recipient: visit.hostEmployeeId,
            channel: "push",
            variables: {
              visitorName: visit.visitorName ?? "",
              gateId: p.gateId,
              checkInTime: timestamp.toISOString(),
            },
          }),
        });
      }

      // Requirement 21.3: VIP arrival alert. When the checked-in visitor is a
      // VIP, immediately alert host + on-duty protocol officer + reception. The
      // three NOTIFICATION_SEND messages are enqueued to the transactional
      // outbox INSIDE this markProcessed-guarded tx (idempotent, atomic with the
      // check-in) — never a raw fire-and-forget publish. A non-VIP check-in
      // enqueues none of these.
      if (visit?.visitorCategory === "vip") {
        await notifyVipArrival(tx, {
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          visitorName: visit.visitorName ?? "",
          hostEmployeeId: visit.hostEmployeeId ?? "",
          locationId: pass.locationId,
          passId: p.passId,
          gateId: p.gateId,
          checkInTime: timestamp.toISOString(),
        });
      }

      // Check-in → badge auto-handoff. On a successful check-in, auto-enqueue a
      // printJobCreate for the visitor's badge so the gate printer produces it
      // without a manual step. Config-gated per tenant via the Wave-3 config
      // engine (visitor_policy key `check_in.auto_print_badge`, default true) so
      // a site that prints badges out-of-band can turn it off. Enqueued through
      // the transactional outbox (COMMANDS.printJobCreate) in the same tx, so it
      // is atomic + idempotent with the check-in (not a raw queue.publish).
      const autoPrintBadge = await getPolicyBoolean(tx, msg.tenantId, "check_in.auto_print_badge");
      if (autoPrintBadge) {
        // Templates key off a badge visitor_category ("default" | "vip" | ...);
        // map the visit's "standard" category to the "default" template bucket.
        const badgeCategory =
          visit?.visitorCategory && visit.visitorCategory !== "standard"
            ? visit.visitorCategory
            : "default";
        await enqueue(tx, {
          topic: COMMANDS.printJobCreate,
          eventType: COMMANDS.printJobCreate,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            id: randomUUID(),
            tenantId: msg.tenantId,
            passId: p.passId,
            deviceId: p.gateTerminalId ?? "",
            priority: "standard",
            printerLanguage: "zpl",
            visitorCategory: badgeCategory,
          },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "check_in", resourceType: "check_in", resourceId: p.passId, outcome: "success" } });
      }

      return {
        locationId: pass.locationId,
        visitorName: visit?.visitorName ?? "",
        hostName: "", // resolved by host-employee lookup out of scope
        hostEmployeeId: visit?.hostEmployeeId ?? "",
        contactNumber: visit?.visitorPhone ?? "",
        checkInTime: timestamp.toISOString(),
        // Previously this stored the raw decrypted identityDocRef itself
        // (not a hash), so the isWatchlisted() call below was comparing a
        // cleartext doc number against a Redis set of HMAC hashes — it
        // could never match. identityDocHash() is the same canonical,
        // doc-type-folded hash used by the blacklist add-path and by
        // document-scan's screening (see modules/blacklist/blind-index.ts).
        identityDocHash: visit?.identityDocRef ? identityDocHash(visit.identityDocRef, visit.identityDocType) : null,
        capacityThreshold: location?.capacityThreshold ?? null,
      };
    });

    if (!committed) return; // already processed (idempotent replay)

    // Requirement 19.5 / Property 28: capacity-threshold ALERT, after
    // commit. Enforcement now happens pre-commit above (assertWithinCapacity)
    // — this block remains a best-effort notification to security control
    // room so they see the location cross the line, including for the
    // residual race the pre-commit check can't close on its own (see the
    // comment above it): two check-ins reading the same pre-add occupancy
    // and both being admitted. Uses the roster counter (already incremented
    // by addToRoster below, or by a prior successful check-in) to decide
    // whether occupancy exceeds the location's configured threshold. On
    // breach, outbox a `capacityThresholdReached` event + NOTIFICATION_SEND
    // to security.
    try {
      if (committed.capacityThreshold != null) {
        const occupancy = await getVisitorCount(msg.tenantId, committed.locationId);
        if (isOverCapacityThreshold(occupancy, committed.capacityThreshold)) {
          // Fire capacity alert in a new short transaction (already committed check-in)
          await db.transaction(async (tx) => {
            await enqueue(tx, {
              topic: EVENTS.capacityThresholdReached,
              eventType: EVENTS.capacityThresholdReached,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: {
                locationId: committed.locationId,
                occupancy,
                capacityThreshold: committed.capacityThreshold,
              },
            });

            // Notify security control room of capacity breach
            await enqueue(tx, {
              topic: NOTIFICATION_SEND,
              eventType: NOTIFICATION_SEND,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: buildNotificationPayload({
                eventType: EVENTS.capacityThresholdReached,
                recipient: "security_control_room",
                channel: "push",
                variables: {
                  locationId: committed.locationId,
                  occupancy: String(occupancy),
                  capacityThreshold: String(committed.capacityThreshold),
                },
              }),
            });
          });

          log.info(
            { tenantId: msg.tenantId, locationId: committed.locationId, occupancy, threshold: committed.capacityThreshold },
            "capacity threshold reached; alert dispatched",
          );
        }
      }
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, locationId: committed.locationId, event: "capacity_check_failed" },
        "capacity-threshold check failed; check-in already committed",
      );
    }

    // Requirement 5.7: if the visitor is watchlist-flagged, notify security
    // control room. Best-effort — never fail the check-in for this.
    try {
      if (committed.identityDocHash) {
        const flagged = await isWatchlisted(msg.tenantId, committed.identityDocHash);
        if (flagged) {
          await db.transaction(async (tx) => {
            await enqueue(tx, {
              topic: NOTIFICATION_SEND,
              eventType: NOTIFICATION_SEND,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: buildNotificationPayload({
                eventType: EVENTS.watchlistMatched,
                recipient: "security_control_room",
                channel: "push",
                variables: {
                  visitorName: committed.visitorName,
                  passId: p.passId,
                  gateId: p.gateId,
                  locationId: committed.locationId,
                  checkInTime: committed.checkInTime,
                },
              }),
            });
          });

          log.info(
            { tenantId: msg.tenantId, passId: p.passId, event: "watchlist_flagged_check_in" },
            "watchlist-flagged visitor checked in; security control room notified",
          );
        }
      }
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, passId: p.passId, event: "watchlist_notification_failed" },
        "watchlist notification dispatch failed; check-in already committed",
      );
    }

    // Requirement 17.1/17.2 — mirror the check-in into the evacuation
    // roster. Best-effort: never fail an already-committed check-in
    // because the roster (Redis) is unavailable.
    try {
      const entry: RosterEntry = {
        passId: p.passId,
        visitorName: committed.visitorName,
        hostName: committed.hostName,
        checkInTime: committed.checkInTime,
        lastKnownGate: p.gateId,
        contactNumber: committed.contactNumber,
        evacuated: false,
      };
      await addToRoster(msg.tenantId, committed.locationId, entry);
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, passId: p.passId, event: "evacuation_roster_add_failed" },
        "evacuation roster add failed; check-in already committed, roster will self-heal on next check-in/out",
      );
    }
  });

  queue.subscribe<CheckOutRecordPayload>(COMMANDS.checkOutRecord, async (msg) => {
    const p = msg.payload;

    const committed: CommittedCheckOut | null = await db.transaction(async (tx): Promise<CommittedCheckOut | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null;

      const passRows = await tx
        .select()
        .from(digitalPasses)
        .where(and(eq(digitalPasses.id, p.passId), eq(digitalPasses.tenantId, msg.tenantId)))
        .limit(1);
      const pass = passRows[0];
      if (!pass) {
        throw new Error(`digital pass '${p.passId}' not found for tenant '${msg.tenantId}'`);
      }

      const nextStatus = domainCheckOut(pass.status as CheckInStatus);

      const timestamp = p.timestamp ? new Date(p.timestamp) : new Date();

      await tx.insert(checkIns).values({
        tenantId: msg.tenantId,
        passId: p.passId,
        locationId: pass.locationId,
        gateId: p.gateId,
        direction: "out",
        timestamp,
        ...(p.gateTerminalId !== undefined ? { gateTerminalId: p.gateTerminalId } : {}),
        offlineRecorded: p.offlineRecorded ?? false,
        verificationMethod: p.verificationMethod ?? "qr",
        createdBy: msg.actorId,
      });

      await tx
        .update(digitalPasses)
        .set({ status: nextStatus, updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(digitalPasses.id, p.passId), eq(digitalPasses.tenantId, msg.tenantId)));

      await enqueue(tx, {
        topic: EVENTS.visitorCheckedOut,
        eventType: EVENTS.visitorCheckedOut,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { passId: p.passId, locationId: pass.locationId, gateId: p.gateId, timestamp: timestamp.toISOString() },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "check_out", resourceType: "check_in", resourceId: p.passId, outcome: "success" } });

      return { locationId: pass.locationId };
    });

    if (!committed) return; // already processed (idempotent replay)

    // Requirement 17.1/17.2 — remove from the evacuation roster. Best-effort,
    // same rationale as the check-in path above.
    try {
      await removeFromRoster(msg.tenantId, committed.locationId, p.passId);
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, passId: p.passId, event: "evacuation_roster_remove_failed" },
        "evacuation roster remove failed; check-out already committed, roster will self-heal on next check-in/out",
      );
    }
  });

  // ─── overstayDetect ──────────────────────────────────────────────────
  // Requirement 6.3/6.4: queries currently checked-in passes whose
  // `valid_until` is in the past, outboxes `overstayAlerted` +
  // NOTIFICATION_SEND to host and security for each overstayed visitor.
  queue.subscribe<OvrstayDetectPayload>(COMMANDS.overstayDetect, async (msg) => {
    const p = msg.payload;
    const now = p.asOf ? new Date(p.asOf) : new Date();

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Find all passes that are currently checked_in and past their valid_until
      const overstayedPasses = await tx
        .select({
          passId: digitalPasses.id,
          locationId: digitalPasses.locationId,
          validUntil: digitalPasses.validUntil,
          visitRequestId: digitalPasses.visitRequestId,
        })
        .from(digitalPasses)
        .where(
          and(
            eq(digitalPasses.tenantId, msg.tenantId),
            eq(digitalPasses.status, "checked_in"),
            lt(digitalPasses.validUntil, now),
            ...(p.locationId ? [eq(digitalPasses.locationId, p.locationId)] : []),
          ),
        );

      for (const pass of overstayedPasses) {
        // Look up the visit request for visitor/host info
        const visitRows = await tx
          .select({
            visitorName: visitRequests.visitorName,
            visitorPhone: visitRequests.visitorPhone,
            hostEmployeeId: visitRequests.hostEmployeeId,
          })
          .from(visitRequests)
          .where(and(eq(visitRequests.id, pass.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)))
          .limit(1);
        const visit = visitRows[0];

        // Outbox: overstayAlerted event (Requirement 6.3)
        await enqueue(tx, {
          topic: EVENTS.overstayAlerted,
          eventType: EVENTS.overstayAlerted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            passId: pass.passId,
            locationId: pass.locationId,
            validUntil: pass.validUntil.toISOString(),
            detectedAt: now.toISOString(),
            visitorName: visit?.visitorName ?? "",
            hostEmployeeId: visit?.hostEmployeeId ?? "",
          },
        });

        // Requirement 6.4: NOTIFICATION_SEND to host about overstay
        if (visit?.hostEmployeeId) {
          await enqueue(tx, {
            topic: NOTIFICATION_SEND,
            eventType: NOTIFICATION_SEND,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: buildNotificationPayload({
              eventType: EVENTS.overstayAlerted,
              recipientId: visit.hostEmployeeId,
              recipient: visit.hostEmployeeId,
              channel: "push",
              variables: {
                visitorName: visit.visitorName ?? "",
                passId: pass.passId,
                validUntil: pass.validUntil.toISOString(),
                detectedAt: now.toISOString(),
              },
            }),
          });
        }

        // Requirement 6.4: NOTIFICATION_SEND to security control room
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.overstayAlerted,
            recipient: "security_control_room",
            channel: "push",
            variables: {
              visitorName: visit?.visitorName ?? "",
              passId: pass.passId,
              locationId: pass.locationId,
              validUntil: pass.validUntil.toISOString(),
              detectedAt: now.toISOString(),
            },
          }),
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "overstay_detect", resourceType: "overstay", resourceId: msg.messageId, outcome: "success" } });
      }

      log.info(
        { tenantId: msg.tenantId, overstayedCount: overstayedPasses.length, asOf: now.toISOString() },
        "overstay detection completed",
      );
    });
  });

  // ─── scanBlacklistMatch ─────────────────────────────────────────────────
  // document-scan/consumer.ts publishes this when a kiosk scan's identity
  // document hash matches the canonical blacklist set, but until now
  // nothing in the service ever subscribed to it — the event was enqueued
  // into the void (no security_incidents row, no alert, nothing the
  // check-in flow could see). This mirrors identity/consumer.ts's
  // face_match_fail handling: create a security_incidents row (incident
  // type "blacklist_match", already documented in schema.ts's comment)
  // and notify security control room, the same way check-in's own
  // watchlist-match path above does. The actual check-in BLOCK for a
  // blacklisted visitor is enforced independently in checkInRecord above
  // (it re-derives and checks the same canonical hash from the visit's own
  // identityDocRef), so this handler's job is purely to make the scan-time
  // hit visible to security ops — it does not gate anything itself.
  queue.subscribe<ScanBlacklistMatchPayload>(EVENTS.scanBlacklistMatch, async (msg) => {
    const p = msg.payload;

    const committed = await db.transaction(async (tx): Promise<{ locationId: string } | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay

      const deviceRows = await tx
        .select({ locationId: devices.locationId })
        .from(devices)
        .where(and(eq(devices.id, p.deviceId), eq(devices.tenantId, msg.tenantId)))
        .limit(1);
      const locationId = deviceRows[0]?.locationId;
      if (!locationId) {
        log.warn(
          { tenantId: msg.tenantId, deviceId: p.deviceId, sessionId: p.sessionId, event: "scan_blacklist_match_no_location" },
          "scanBlacklistMatch: could not resolve scanner device to a location; security incident not recorded",
        );
        return null;
      }

      await tx.insert(securityIncidents).values({
        tenantId: msg.tenantId,
        locationId,
        incidentType: "blacklist_match",
        description: `Document scan matched an active blacklist entry (session ${p.sessionId}, doc type ${p.idDocumentType ?? "unknown"})`,
        severity: "critical",
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.securityIncidentCreated,
        eventType: EVENTS.securityIncidentCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          locationId,
          incidentType: "blacklist_match",
          severity: "critical",
          sessionId: p.sessionId,
          ocrResultId: p.ocrResultId,
        },
      });

      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.scanBlacklistMatch,
          recipient: "security_control_room",
          channel: "push",
          variables: {
            sessionId: p.sessionId,
            deviceId: p.deviceId,
            locationId,
          },
        }),
      });

      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "create", resourceType: "security_incident", resourceId: msg.messageId, outcome: "success" } });

      return { locationId };
    });

    if (!committed) return; // already processed, or location could not be resolved

    log.info(
      { tenantId: msg.tenantId, sessionId: p.sessionId, locationId: committed.locationId, event: "scan_blacklist_match_incident_created" },
      "document-scan blacklist match recorded as a security incident",
    );
  });
}
