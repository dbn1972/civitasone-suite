/**
 * Calendar module — property-based test (task 15.3).
 *
 * Property 28: No double-booking — no two confirmed bookings for the same room have overlapping
 * [start_at, end_at) intervals. Uses the pure domain functions from
 * `src/modules/calendar/domain.ts`:
 *   - `intervalsOverlap` — half-open interval overlap detection
 *   - `bookingsConflict` — same-room + both-confirmed + overlapping test
 *   - `findRoomConflicts` — filters conflicting bookings from an existing set
 *   - `assertNoRoomConflict` — throws ROOM_DOUBLE_BOOKED (409) on conflict
 *
 * Uses fast-check (fc.property / fc.assert) with random booking intervals on the same room.
 * Asserts that any pair of confirmed bookings that passes assertNoRoomConflict has
 * non-overlapping windows.
 *
 * **Validates: Requirements 14.3**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { HttpError } from "../src/shared/context.js";
import {
  intervalsOverlap,
  bookingsConflict,
  findRoomConflicts,
  assertNoRoomConflict,
  type RoomBookingLike,
} from "../src/modules/calendar/domain.js";

// ─── Arbitraries (smart generators that constrain to the input space) ─────────

/** Generate a valid Date within a reasonable range (2024–2027). */
const arbDate = fc.integer({ min: 1704067200000, max: 1798761600000 }).map((ms) => new Date(ms));

/** Generate a valid half-open interval [start, end) where end > start. */
const arbInterval = fc
  .tuple(arbDate, fc.integer({ min: 1, max: 480 })) // start + duration in minutes (1 min to 8 hours)
  .map(([start, durationMinutes]) => ({
    start,
    end: new Date(start.getTime() + durationMinutes * 60 * 1000),
  }));

/** Generate a room ID from a small set to increase collision likelihood. */
const arbRoomId = fc.constantFrom("room-A", "room-B", "room-C", "room-D");

/** Generate a booking status: confirmed or cancelled. */
const arbStatus = fc.constantFrom("confirmed", "cancelled");

/** Generate a booking ID. */
const arbBookingId = fc.uuid();

/** Generate a RoomBookingLike object. */
const arbBooking: fc.Arbitrary<RoomBookingLike> = fc
  .tuple(arbBookingId, arbRoomId, arbInterval, arbStatus)
  .map(([id, roomId, interval, status]) => ({
    id,
    roomId,
    startAt: interval.start,
    endAt: interval.end,
    status,
  }));

/** Generate a confirmed booking for a specific room (to test same-room conflicts). */
function arbConfirmedBookingForRoom(roomId: string): fc.Arbitrary<RoomBookingLike> {
  return fc.tuple(arbBookingId, arbInterval).map(([id, interval]) => ({
    id,
    roomId,
    startAt: interval.start,
    endAt: interval.end,
    status: "confirmed",
  }));
}

// ─── Property tests ───────────────────────────────────────────────────────────

describe("P28: No double-booking — property-based tests", () => {
  it("intervalsOverlap is symmetric: overlap(A, B) === overlap(B, A)", () => {
    fc.assert(
      fc.property(arbInterval, arbInterval, (a, b) => {
        expect(intervalsOverlap(a.start, a.end, b.start, b.end)).toBe(
          intervalsOverlap(b.start, b.end, a.start, a.end),
        );
      }),
      { numRuns: 500 },
    );
  });

  it("adjacent intervals do NOT overlap: [A.start, A.end) and [A.end, B.end) are conflict-free", () => {
    fc.assert(
      fc.property(
        arbDate,
        fc.integer({ min: 1, max: 240 }),
        fc.integer({ min: 1, max: 240 }),
        (start, durA, durB) => {
          const aEnd = new Date(start.getTime() + durA * 60_000);
          const bEnd = new Date(aEnd.getTime() + durB * 60_000);
          // A ends exactly when B starts — half-open semantics: no overlap.
          expect(intervalsOverlap(start, aEnd, aEnd, bEnd)).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("an interval always overlaps with itself", () => {
    fc.assert(
      fc.property(arbInterval, (iv) => {
        expect(intervalsOverlap(iv.start, iv.end, iv.start, iv.end)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("bookingsConflict: a booking never conflicts with itself (same id)", () => {
    fc.assert(
      fc.property(arbBooking, (booking) => {
        const clone = { ...booking };
        expect(bookingsConflict(booking, clone)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("bookingsConflict: cancelled bookings never conflict", () => {
    fc.assert(
      fc.property(arbRoomId, arbInterval, arbInterval, (roomId, ivA, ivB) => {
        const a: RoomBookingLike = { id: "id-a", roomId, startAt: ivA.start, endAt: ivA.end, status: "cancelled" };
        const b: RoomBookingLike = { id: "id-b", roomId, startAt: ivB.start, endAt: ivB.end, status: "confirmed" };
        // If either is cancelled, no conflict.
        expect(bookingsConflict(a, b)).toBe(false);
        expect(bookingsConflict(b, a)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("bookingsConflict: different rooms never conflict even if times overlap", () => {
    fc.assert(
      fc.property(arbInterval, (iv) => {
        const a: RoomBookingLike = { id: "id-a", roomId: "room-X", startAt: iv.start, endAt: iv.end, status: "confirmed" };
        const b: RoomBookingLike = { id: "id-b", roomId: "room-Y", startAt: iv.start, endAt: iv.end, status: "confirmed" };
        expect(bookingsConflict(a, b)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("P28 core: any pair of confirmed bookings passing assertNoRoomConflict has non-overlapping windows", () => {
    fc.assert(
      fc.property(
        arbRoomId,
        fc.array(arbInterval, { minLength: 1, maxLength: 10 }),
        arbInterval,
        (roomId, existingIntervals, candidateInterval) => {
          // Build existing confirmed bookings for the same room.
          const existing: RoomBookingLike[] = existingIntervals.map((iv, idx) => ({
            id: `existing-${idx}`,
            roomId,
            startAt: iv.start,
            endAt: iv.end,
            status: "confirmed",
          }));

          const candidate: RoomBookingLike = {
            id: "candidate",
            roomId,
            startAt: candidateInterval.start,
            endAt: candidateInterval.end,
            status: "confirmed",
          };

          let passed = false;
          try {
            assertNoRoomConflict(existing, candidate);
            passed = true;
          } catch (err) {
            // If assertNoRoomConflict throws, it must be ROOM_DOUBLE_BOOKED.
            expect(err).toBeInstanceOf(HttpError);
            expect((err as HttpError).code).toBe("ROOM_DOUBLE_BOOKED");
            expect((err as HttpError).status).toBe(409);
          }

          if (passed) {
            // The property: if assertNoRoomConflict does NOT throw, then the candidate's
            // interval must NOT overlap with ANY existing confirmed booking's interval.
            for (const b of existing) {
              expect(
                intervalsOverlap(candidate.startAt, candidate.endAt, b.startAt, b.endAt),
              ).toBe(false);
            }
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("P28 converse: if overlapping confirmed bookings exist, assertNoRoomConflict throws", () => {
    fc.assert(
      fc.property(
        arbRoomId,
        arbDate,
        fc.integer({ min: 30, max: 240 }),
        fc.integer({ min: 1, max: 29 }),
        (roomId, baseStart, duration, offset) => {
          // Construct two overlapping bookings: the candidate starts before the existing ends.
          const existingStart = baseStart;
          const existingEnd = new Date(baseStart.getTime() + duration * 60_000);
          // Candidate starts within the existing booking's window.
          const candidateStart = new Date(existingStart.getTime() + offset * 60_000);
          const candidateEnd = new Date(candidateStart.getTime() + duration * 60_000);

          const existing: RoomBookingLike[] = [
            { id: "existing-1", roomId, startAt: existingStart, endAt: existingEnd, status: "confirmed" },
          ];
          const candidate: RoomBookingLike = {
            id: "candidate",
            roomId,
            startAt: candidateStart,
            endAt: candidateEnd,
            status: "confirmed",
          };

          // Verify interval actually overlaps (candidate starts before existing ends).
          expect(intervalsOverlap(candidateStart, candidateEnd, existingStart, existingEnd)).toBe(true);

          // assertNoRoomConflict must throw for overlapping confirmed bookings on same room.
          expect(() => assertNoRoomConflict(existing, candidate)).toThrow(HttpError);
          try {
            assertNoRoomConflict(existing, candidate);
          } catch (err) {
            expect((err as HttpError).code).toBe("ROOM_DOUBLE_BOOKED");
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("findRoomConflicts returns exactly the bookings that overlap the candidate", () => {
    fc.assert(
      fc.property(
        arbRoomId,
        fc.array(arbInterval, { minLength: 0, maxLength: 8 }),
        arbInterval,
        (roomId, existingIntervals, candidateInterval) => {
          const existing: RoomBookingLike[] = existingIntervals.map((iv, idx) => ({
            id: `e-${idx}`,
            roomId,
            startAt: iv.start,
            endAt: iv.end,
            status: "confirmed",
          }));

          const candidate: RoomBookingLike = {
            id: "cand",
            roomId,
            startAt: candidateInterval.start,
            endAt: candidateInterval.end,
            status: "confirmed",
          };

          const conflicts = findRoomConflicts(existing, candidate);

          // Every returned conflict must actually overlap.
          for (const c of conflicts) {
            expect(intervalsOverlap(candidate.startAt, candidate.endAt, c.startAt, c.endAt)).toBe(true);
            expect(c.roomId).toBe(roomId);
          }

          // Every existing booking that overlaps must be in the conflicts result.
          for (const b of existing) {
            const overlaps = intervalsOverlap(candidate.startAt, candidate.endAt, b.startAt, b.endAt);
            if (overlaps) {
              expect(conflicts).toContainEqual(b);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
