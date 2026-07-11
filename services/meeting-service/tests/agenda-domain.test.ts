/**
 * Agenda module — pure domain tests.
 *
 * TWO purposes in one file (domain.ts is pure — no I/O, no DB — so everything here runs in-memory):
 *
 *   1. Task 5.4 property tests for agenda ordering:
 *        • Property 26 (Contiguous sequence) — accepted items have sequences 1..N with no gaps or
 *          duplicates. Verified for `orderAgendaItems` (the insert/carry-forward path) AND for
 *          `applyReorder` (the explicit reorder path).
 *        • Property 27 (Reorder idempotency) — the same reorder applied twice equals applied once.
 *      **Validates: Requirements 3.3, 3.4**
 *
 *   2. Branch-coverage unit tests for the remaining domain rules (category ordering, reorder
 *      bijection validation, lock enforcement, submission-deadline enforcement, duration-overrun
 *      warning, deferred carry-forward) — companion to task 5.4 raising the agenda module to ≥80%.
 *
 * fast-check is not a dependency of the suite, so the property tests use a deterministic seeded
 * PRNG (mulberry32) and exercise many generated inputs per property — thorough example generation
 * that keeps the run reproducible and dependency-free.
 */
import { describe, it, expect } from "vitest";
import { HttpError } from "../src/shared/context.js";
import {
  AGENDA_CATEGORIES,
  orderAgendaItems,
  validateReorderBijection,
  applyReorder,
  assertAgendaNotLocked,
  computeSubmissionDeadline,
  isPastSubmissionDeadline,
  assertSubmissionAllowed,
  computeDurationOverrun,
  buildCarryForward,
  DEFAULT_SUBMISSION_DEADLINE_DAYS,
  DEFAULT_DURATION_OVERRUN_THRESHOLD_PCT,
  type OrderableAgendaItem,
  type ReorderEntry,
  type CarryForwardSource,
} from "../src/modules/agenda/domain.js";

// ─── Deterministic PRNG (mulberry32) for reproducible generated inputs ───────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rngInt = (rnd: () => number, min: number, max: number): number =>
  min + Math.floor(rnd() * (max - min + 1));

/** Fisher–Yates shuffle using the injected PRNG. */
function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CATEGORY_OR_NULL = [...AGENDA_CATEGORIES, null, undefined, "bogus_category"] as const;

// ─── Property 26 — contiguous 1..N sequence (Req 3.3) ────────────────────────

describe("P26 contiguous sequence — no gaps or duplicates (Validates: Requirements 3.3, 3.4)", () => {
  it("orderAgendaItems yields exactly {1..N} for arbitrary item sets", () => {
    const rnd = mulberry32(0xa9e0_1d26);
    for (let iter = 0; iter < 400; iter++) {
      const n = rngInt(rnd, 0, 40);
      const items: OrderableAgendaItem[] = Array.from({ length: n }, (_, i) => {
        const cat = CATEGORY_OR_NULL[rngInt(rnd, 0, CATEGORY_OR_NULL.length - 1)];
        // Mix of null sequences and arbitrary (possibly colliding / negative) existing sequences.
        const seq = rnd() < 0.3 ? null : rngInt(rnd, -5, 60);
        return { id: `item-${iter}-${i}`, category: cat as string | null, sequence: seq };
      });

      const ordered = orderAgendaItems(items);

      expect(ordered).toHaveLength(n);
      const seqs = ordered.map((o) => o.sequence).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: n }, (_, i) => i + 1)); // exactly 1..N, gap/dup-free
      // Every original id is present exactly once (a bijection over ids).
      expect(new Set(ordered.map((o) => o.id)).size).toBe(n);
    }
  });

  it("applyReorder yields exactly {1..N} for arbitrary valid bijection payloads", () => {
    const rnd = mulberry32(0x51c0_ffee);
    for (let iter = 0; iter < 400; iter++) {
      const n = rngInt(rnd, 1, 40);
      const ids = Array.from({ length: n }, (_, i) => `it-${iter}-${i}`);
      const seqs = shuffle(
        Array.from({ length: n }, (_, i) => i + 1),
        rnd,
      );
      const order: ReorderEntry[] = ids.map((id, i) => ({ agendaItemId: id, sequence: seqs[i]! }));

      const applied = applyReorder(order);
      const out = applied.map((e) => e.sequence).sort((a, b) => a - b);
      expect(out).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(new Set(applied.map((e) => e.agendaItemId)).size).toBe(n);
    }
  });
});

// ─── Property 27 — reorder idempotency (Req 3.4) ─────────────────────────────

describe("P27 reorder idempotency — applying twice equals applying once (Validates: Requirements 3.3, 3.4)", () => {
  it("applyReorder(applyReorder(x)) === applyReorder(x) for arbitrary bijections", () => {
    const rnd = mulberry32(0x1dea_2727);
    for (let iter = 0; iter < 400; iter++) {
      const n = rngInt(rnd, 1, 40);
      const ids = Array.from({ length: n }, (_, i) => `x-${iter}-${i}`);
      const seqs = shuffle(
        Array.from({ length: n }, (_, i) => i + 1),
        rnd,
      );
      const order: ReorderEntry[] = ids.map((id, i) => ({ agendaItemId: id, sequence: seqs[i]! }));

      const once = applyReorder(order);
      const twice = applyReorder(once);
      expect(twice).toEqual(once);

      // And the canonical ordering matches the requested sequence order (id at target position).
      const expectedIds = [...order].sort((a, b) => a.sequence - b.sequence).map((e) => e.agendaItemId);
      expect(once.map((e) => e.agendaItemId)).toEqual(expectedIds);
    }
  });
});

// ─── orderAgendaItems — category grouping + stability (Req 3.3) ───────────────

describe("orderAgendaItems category grouping", () => {
  it("orders standing → arising_from_minutes → new_business, unknown/absent categories last", () => {
    const items: OrderableAgendaItem[] = [
      { id: "new1", category: "new_business", sequence: 1 },
      { id: "stand1", category: "standing", sequence: 2 },
      { id: "arise1", category: "arising_from_minutes", sequence: 3 },
      { id: "unknown1", category: "mystery", sequence: 4 },
      { id: "null1", category: null, sequence: 5 },
    ];
    const ordered = orderAgendaItems(items);
    const idsInOrder = ordered.map((o) => o.id);
    // standing first, arising second, then new_business + unknown + null all share the last rank
    // (tie-broken by existing sequence: new1(1) < unknown1(4) < null1(5)).
    expect(idsInOrder).toEqual(["stand1", "arise1", "new1", "unknown1", "null1"]);
    expect(ordered.map((o) => o.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it("is stable within a category group (equal rank keeps insertion order when sequences tie)", () => {
    const items: OrderableAgendaItem[] = [
      { id: "a", category: "standing", sequence: null },
      { id: "b", category: "standing", sequence: null },
      { id: "c", category: "standing", sequence: null },
    ];
    expect(orderAgendaItems(items).map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("re-running on an already-ordered list is a no-op (idempotent)", () => {
    const items: OrderableAgendaItem[] = [
      { id: "s", category: "standing", sequence: 1 },
      { id: "a", category: "arising_from_minutes", sequence: 2 },
      { id: "n", category: "new_business", sequence: 3 },
    ];
    const once = orderAgendaItems(items);
    const twice = orderAgendaItems(once);
    expect(twice).toEqual(once);
  });

  it("handles an empty list", () => {
    expect(orderAgendaItems([])).toEqual([]);
  });
});

// ─── validateReorderBijection — all rejection branches (Req 3.4) ──────────────

describe("validateReorderBijection", () => {
  it("accepts a valid 1..N bijection (and the empty payload)", () => {
    expect(() => validateReorderBijection([])).not.toThrow();
    expect(() =>
      validateReorderBijection([
        { agendaItemId: "a", sequence: 2 },
        { agendaItemId: "b", sequence: 1 },
        { agendaItemId: "c", sequence: 3 },
      ]),
    ).not.toThrow();
  });

  it("rejects a duplicate agendaItemId", () => {
    try {
      validateReorderBijection([
        { agendaItemId: "a", sequence: 1 },
        { agendaItemId: "a", sequence: 2 },
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("VALIDATION_FAILED");
      expect((err as HttpError).status).toBe(400);
    }
  });

  it("rejects a sequence outside 1..N (too high, zero, non-integer)", () => {
    expect(() => validateReorderBijection([{ agendaItemId: "a", sequence: 2 }])).toThrow(HttpError); // N=1, seq 2
    expect(() => validateReorderBijection([{ agendaItemId: "a", sequence: 0 }])).toThrow(HttpError);
    expect(() => validateReorderBijection([{ agendaItemId: "a", sequence: 1.5 }])).toThrow(HttpError);
  });

  it("rejects a duplicate sequence", () => {
    try {
      validateReorderBijection([
        { agendaItemId: "a", sequence: 1 },
        { agendaItemId: "b", sequence: 1 },
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HttpError).code).toBe("VALIDATION_FAILED");
      expect((err as HttpError).details).toMatchObject({ sequence: 1 });
    }
  });
});

// ─── assertAgendaNotLocked (Req 3.4) ──────────────────────────────────────────

describe("assertAgendaNotLocked", () => {
  it("throws MEETING_AGENDA_LOCKED (422) only when status is agenda_locked", () => {
    for (const status of ["draft", "scheduled", "in_progress", "closed"]) {
      expect(() => assertAgendaNotLocked(status)).not.toThrow();
    }
    try {
      assertAgendaNotLocked("agenda_locked");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("MEETING_AGENDA_LOCKED");
      expect((err as HttpError).status).toBe(422);
    }
  });
});

// ─── Submission deadline (Req 3.5) ────────────────────────────────────────────

describe("submission deadline", () => {
  const scheduled = new Date("2030-06-30T10:00:00.000Z");

  it("computeSubmissionDeadline uses the default 7 days when unconfigured", () => {
    const deadline = computeSubmissionDeadline(scheduled);
    expect(deadline.getTime()).toBe(scheduled.getTime() - DEFAULT_SUBMISSION_DEADLINE_DAYS * MS_PER_DAY);
  });

  it("computeSubmissionDeadline honours a configured window (incl. 0 days)", () => {
    expect(computeSubmissionDeadline(scheduled, { submissionDeadlineDays: 3 }).getTime()).toBe(
      scheduled.getTime() - 3 * MS_PER_DAY,
    );
    expect(computeSubmissionDeadline(scheduled, { submissionDeadlineDays: 0 }).getTime()).toBe(scheduled.getTime());
  });

  it("falls back to the default for an invalid/negative configured window", () => {
    const def = computeSubmissionDeadline(scheduled).getTime();
    expect(computeSubmissionDeadline(scheduled, { submissionDeadlineDays: -1 }).getTime()).toBe(def);
    expect(computeSubmissionDeadline(scheduled, { submissionDeadlineDays: Number.NaN }).getTime()).toBe(def);
  });

  it("isPastSubmissionDeadline flips at/after the cut-off", () => {
    const deadline = computeSubmissionDeadline(scheduled);
    expect(isPastSubmissionDeadline(scheduled, new Date(deadline.getTime() - 1))).toBe(false);
    expect(isPastSubmissionDeadline(scheduled, deadline)).toBe(true);
    expect(isPastSubmissionDeadline(scheduled, new Date(deadline.getTime() + 1))).toBe(true);
  });

  it("assertSubmissionAllowed: passes before cut-off, throws MEETING_PAST_DEADLINE after", () => {
    const before = new Date(scheduled.getTime() - 10 * MS_PER_DAY);
    const after = new Date(scheduled.getTime() - 1 * MS_PER_DAY);
    expect(() => assertSubmissionAllowed({ scheduledAt: scheduled, now: before })).not.toThrow();
    try {
      assertSubmissionAllowed({ scheduledAt: scheduled, now: after });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HttpError).code).toBe("MEETING_PAST_DEADLINE");
      expect((err as HttpError).status).toBe(422);
    }
  });

  it("assertSubmissionAllowed: chairperson approval bypasses the deadline", () => {
    const after = new Date(scheduled.getTime() - 1 * MS_PER_DAY);
    expect(() =>
      assertSubmissionAllowed({ scheduledAt: scheduled, now: after, isChairpersonApproved: true }),
    ).not.toThrow();
  });

  it("assertSubmissionAllowed: a draft meeting with no scheduledAt always passes", () => {
    expect(() => assertSubmissionAllowed({ scheduledAt: null, now: new Date() })).not.toThrow();
    expect(() => assertSubmissionAllowed({ scheduledAt: undefined, now: new Date() })).not.toThrow();
  });
});

// ─── Duration overrun (Req 3.7) ───────────────────────────────────────────────

describe("computeDurationOverrun", () => {
  it("sums only accepted items and flags a warning past the default 15% threshold", () => {
    const items = [
      { status: "accepted", durationMinutes: 40 },
      { status: "accepted", durationMinutes: 40 }, // 80 total accepted
      { status: "proposed", durationMinutes: 100 }, // excluded (not accepted)
      { status: "deferred", durationMinutes: 100 }, // excluded
    ];
    const r = computeDurationOverrun(items, 60);
    expect(r.totalMinutes).toBe(80);
    expect(r.scheduledMinutes).toBe(60);
    expect(r.overByMinutes).toBe(20);
    expect(Math.round(r.overByPct)).toBe(33);
    expect(r.warn).toBe(true); // 33% > 15%
    expect(DEFAULT_DURATION_OVERRUN_THRESHOLD_PCT).toBe(15);
  });

  it("does not warn when within budget or exactly at threshold", () => {
    // within budget
    expect(computeDurationOverrun([{ status: "accepted", durationMinutes: 50 }], 60).warn).toBe(false);
    // exactly +15% (69 vs 60) → not strictly over the threshold
    const at = computeDurationOverrun([{ status: "accepted", durationMinutes: 69 }], 60);
    expect(Math.round(at.overByPct)).toBe(15);
    expect(at.warn).toBe(false);
  });

  it("honours a custom threshold", () => {
    const r = computeDurationOverrun([{ status: "accepted", durationMinutes: 66 }], 60, {
      durationOverrunThresholdPct: 5,
    });
    expect(r.warn).toBe(true); // 10% > 5%
  });

  it("treats a non-positive scheduled duration as no-warn and clamps negatives/nulls", () => {
    const r = computeDurationOverrun([{ status: "accepted", durationMinutes: 30 }], 0);
    expect(r.scheduledMinutes).toBe(0);
    expect(r.overByPct).toBe(0);
    expect(r.warn).toBe(false);
    // null / negative per-item durations clamp to 0.
    const r2 = computeDurationOverrun(
      [
        { status: "accepted", durationMinutes: null },
        { status: "accepted", durationMinutes: -50 },
        { status: "accepted" },
      ],
      60,
    );
    expect(r2.totalMinutes).toBe(0);
  });
});

// ─── Carry-forward (Req 3.6) ──────────────────────────────────────────────────

describe("buildCarryForward", () => {
  const source: CarryForwardSource = {
    id: "src-1",
    tenantId: "t-1",
    title: "Budget review",
    description: "carried topic",
    outcomeType: "decision",
    durationMinutes: 25,
    presenterId: "p-1",
    confidentialityLevel: "confidential",
    category: "new_business",
    linkedDecisionId: "d-1",
    fileReference: "F/2030/1",
  };

  it("clones the source onto the next meeting as carried_forward and marks the source deferred", () => {
    const plan = buildCarryForward(source, { nextMeetingId: "next-1", actorId: "actor-1" });
    expect(plan.next).toMatchObject({
      tenantId: "t-1",
      meetingId: "next-1",
      title: "Budget review",
      outcomeType: "decision",
      durationMinutes: 25,
      confidentialityLevel: "confidential",
      category: "new_business",
      status: "carried_forward",
      createdBy: "actor-1",
      updatedBy: "actor-1",
    });
    expect(plan.sourceUpdate).toEqual({ id: "src-1", status: "deferred" });
  });

  it("applies field defaults when the source omits optional fields", () => {
    const minimal: CarryForwardSource = {
      id: "src-2",
      tenantId: "t-2",
      title: "Minimal",
      outcomeType: "discussion",
    };
    const plan = buildCarryForward(minimal, { nextMeetingId: "next-2", actorId: "actor-2" });
    expect(plan.next.description).toBeNull();
    expect(plan.next.durationMinutes).toBe(15); // default
    expect(plan.next.presenterId).toBeNull();
    expect(plan.next.confidentialityLevel).toBe("internal"); // default
    expect(plan.next.category).toBeNull();
    expect(plan.next.linkedDecisionId).toBeNull();
    expect(plan.next.fileReference).toBeNull();
  });
});
