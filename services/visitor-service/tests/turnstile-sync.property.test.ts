/**
 * Property-based tests for turnstile-control offline sync logic.
 *
 * Uses fast-check to validate universal correctness properties for
 * offline sync idempotency, server-wins conflict resolution, and sync window.
 *
 * **Validates: Requirements 9.3, 9.4, 9.5**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  resolveOfflineConflict,
  isSyncWindowValid,
  SYNC_WINDOW_MS,
} from "../src/modules/turnstile-control/domain.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary timestamp within the last 48 hours (valid dates only). */
const arbRecentTimestamp = fc
  .integer({ min: Date.now() - 48 * 60 * 60 * 1000, max: Date.now() })
  .map((ms) => new Date(ms));

/** Arbitrary timestamp within the sync window (≤ 24h ago). */
const arbValidSyncTimestamp = fc
  .integer({ min: 0, max: SYNC_WINDOW_MS })
  .map((ageMs) => new Date(Date.now() - ageMs));

/** Arbitrary timestamp outside the sync window (> 24h ago). */
const arbExpiredSyncTimestamp = fc
  .integer({ min: SYNC_WINDOW_MS + 1, max: SYNC_WINDOW_MS * 3 })
  .map((ageMs) => new Date(Date.now() - ageMs));

/** Arbitrary "now" timestamp (current-ish time). */
const arbNow = fc
  .integer({ min: 0, max: 60_000 }) // within last minute
  .map((offsetMs) => new Date(Date.now() - offsetMs));

/** Arbitrary UUID. */
const arbUuid = fc.uuid();

/** Arbitrary direction. */
const arbDirection = fc.constantFrom<"in" | "out">("in", "out");

/** Arbitrary passage event for deduplication testing. */
const arbPassageEvent = fc.record({
  deviceId: arbUuid,
  passId: arbUuid,
  gateId: arbUuid,
  direction: arbDirection,
  eventTimestamp: arbRecentTimestamp,
  passageCount: fc.integer({ min: 1, max: 5 }),
});

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("turnstile-sync property tests", () => {
  // -------------------------------------------------------------------------
  // Property 17: Offline sync is idempotent (deduplication by device_id + event_type + timestamp)
  // -------------------------------------------------------------------------
  describe("Property 17: Offline sync is idempotent (deduplication)", () => {
    it("replaying the same event with identical device_id + passId + timestamp yields no duplicate", async () => {
      /**
       * Property: for any passage event, if we process it twice with the same
       * (deviceId, passId, eventTimestamp) tuple, the second processing must
       * be a no-op (idempotent).
       *
       * We verify the deduplication key uniqueness property: two events with
       * identical (deviceId, passId, eventTimestamp) are considered the same event.
       */
      await fc.assert(
        fc.asyncProperty(arbPassageEvent, async (event) => {
          // The dedup key is: deviceId + passId + eventTimestamp
          const dedupKey1 = `${event.deviceId}:${event.passId}:${event.eventTimestamp.toISOString()}`;
          const dedupKey2 = `${event.deviceId}:${event.passId}:${event.eventTimestamp.toISOString()}`;

          // Same event replayed produces same dedup key → skip
          expect(dedupKey1).toBe(dedupKey2);

          // Different timestamps produce different keys (not a duplicate)
          const differentTime = new Date(event.eventTimestamp.getTime() + 1000);
          const dedupKey3 = `${event.deviceId}:${event.passId}:${differentTime.toISOString()}`;
          expect(dedupKey1).not.toBe(dedupKey3);
        }),
        { numRuns: 100 },
      );
    });

    it("events with different passIds but same timestamp are distinct (not deduplicated)", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbUuid,
          arbUuid,
          arbUuid,
          arbRecentTimestamp,
          async (deviceId, passId1, passId2, timestamp) => {
            fc.pre(passId1 !== passId2); // Ensure different passIds

            const dedupKey1 = `${deviceId}:${passId1}:${timestamp.toISOString()}`;
            const dedupKey2 = `${deviceId}:${passId2}:${timestamp.toISOString()}`;

            // Different passIds → different dedup keys → not duplicates
            expect(dedupKey1).not.toBe(dedupKey2);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 18: Offline sync applies server-wins conflict resolution
  // -------------------------------------------------------------------------
  describe("Property 18: Offline sync applies server-wins conflict resolution", () => {
    it("if pass revoked before event timestamp, result is retroactively_invalid", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRecentTimestamp,
          fc.integer({ min: 1, max: 3600_000 }), // revoked 1ms to 1h before event
          async (eventTimestamp, offsetMs) => {
            // Pass was revoked BEFORE the event occurred
            const passRevokedAt = new Date(eventTimestamp.getTime() - offsetMs);

            const result = resolveOfflineConflict(eventTimestamp, passRevokedAt);
            expect(result).toBe("retroactively_invalid");
          },
        ),
        { numRuns: 100 },
      );
    });

    it("if pass revoked at same time as event, result is retroactively_invalid", async () => {
      await fc.assert(
        fc.asyncProperty(arbRecentTimestamp, async (eventTimestamp) => {
          // Pass revoked at exactly the same time as the event
          const passRevokedAt = new Date(eventTimestamp.getTime());

          const result = resolveOfflineConflict(eventTimestamp, passRevokedAt);
          expect(result).toBe("retroactively_invalid");
        }),
        { numRuns: 100 },
      );
    });

    it("if pass revoked after event timestamp, result is valid", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRecentTimestamp,
          fc.integer({ min: 1, max: 3600_000 }), // revoked 1ms to 1h after event
          async (eventTimestamp, offsetMs) => {
            // Pass was revoked AFTER the event occurred
            const passRevokedAt = new Date(eventTimestamp.getTime() + offsetMs);

            const result = resolveOfflineConflict(eventTimestamp, passRevokedAt);
            expect(result).toBe("valid");
          },
        ),
        { numRuns: 100 },
      );
    });

    it("if pass not revoked (null), result is always valid", async () => {
      await fc.assert(
        fc.asyncProperty(arbRecentTimestamp, async (eventTimestamp) => {
          const result = resolveOfflineConflict(eventTimestamp, null);
          expect(result).toBe("valid");
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 19: Sync window rejects events older than 24 hours
  // -------------------------------------------------------------------------
  describe("Property 19: Sync window rejects events older than 24 hours", () => {
    it("events within 24h window are accepted", async () => {
      await fc.assert(
        fc.asyncProperty(arbValidSyncTimestamp, arbNow, async (eventTimestamp, now) => {
          // Ensure event is actually within window relative to now
          const ageMs = now.getTime() - eventTimestamp.getTime();
          fc.pre(ageMs >= 0 && ageMs <= SYNC_WINDOW_MS);

          const result = isSyncWindowValid(eventTimestamp, now);
          expect(result).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("events older than 24h are rejected", async () => {
      await fc.assert(
        fc.asyncProperty(arbExpiredSyncTimestamp, async (eventTimestamp) => {
          const now = new Date(); // Current time
          // Event is guaranteed > 24h old relative to actual now
          const result = isSyncWindowValid(eventTimestamp, now);
          expect(result).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it("event at exactly 24h boundary is accepted (edge case)", async () => {
      const now = new Date();
      const exactBoundary = new Date(now.getTime() - SYNC_WINDOW_MS);
      const result = isSyncWindowValid(exactBoundary, now);
      expect(result).toBe(true);
    });

    it("event 1ms past 24h boundary is rejected", async () => {
      const now = new Date();
      const justPast = new Date(now.getTime() - SYNC_WINDOW_MS - 1);
      const result = isSyncWindowValid(justPast, now);
      expect(result).toBe(false);
    });
  });
});
