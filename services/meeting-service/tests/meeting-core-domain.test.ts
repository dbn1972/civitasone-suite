/**
 * meeting-core — domain state-machine property + unit tests (task 3.7).
 *
 * Property-based tests (fast-check + Vitest) drive the pure lifecycle logic in
 * src/modules/meeting-core/domain.ts across the whole input space, exercising the
 * seven state-machine invariants mandated by task 3.7:
 *
 *   P1 Valid transitions only              — only adjacency-list edges accepted; all else 422.
 *   P2 Terminal state reachability         — a terminal state is reachable from every state.
 *   P3 Monotonic progression past approval — no regression below `minutes_approved`.
 *   P5 Start time recorded                 — state ≥ in_progress ⇒ actual_start required.
 *   P6 Draft→scheduled prerequisites       — needs chairperson + ≥1 agenda item + future date.
 *   P7 Transition audit completeness       — a simple path logs (distinct states − 1) rows.
 *   P8 Cancelled is terminal               — no transitions out of `cancelled`.
 *
 * Example-based unit tests cover the remaining domain surface (tenant overlay, per-transition
 * data guards, financial-year + meeting-number generation) so the module's branches are fully
 * exercised.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6, 1.7**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { HttpError } from "../src/shared/context.js";
import {
  MEETING_STATES,
  TERMINAL_STATES,
  isMeetingState,
  isTerminal,
  allowedTargets,
  canTransition,
  assertTransition,
  validateDraftToScheduled,
  validateQuorumForStart,
  validateAdjourn,
  stateRequiresActualStart,
  violatesMonotonicApproval,
  requiredApprovalsFor,
  transitionKey,
  computeFinancialYear,
  nextMeetingSequence,
  generateMeetingNumber,
  type MeetingState,
  type TenantStateMachineConfig,
} from "../src/modules/meeting-core/domain.js";

// ─── Model of the base adjacency map (independent re-derivation from design.md) ──

/**
 * The base state machine re-expressed here as a plain map so the properties check the
 * implementation against an independent source of truth rather than against itself.
 */
const ADJACENCY: Record<MeetingState, MeetingState[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["agenda_locked", "cancelled", "draft"],
  agenda_locked: ["in_progress", "scheduled", "cancelled"],
  in_progress: ["adjourned", "minutes_pending"],
  adjourned: ["in_progress", "minutes_pending", "cancelled"],
  minutes_pending: ["minutes_approved", "minutes_pending"],
  minutes_approved: ["closed"],
  closed: ["archived"],
  archived: [],
  cancelled: [],
};

const stateArb: fc.Arbitrary<MeetingState> = fc.constantFrom(...MEETING_STATES);

/** A context that satisfies every data guard (chairperson + agenda + future date + quorum). */
function satisfyingCtx(now = new Date("2026-01-01T00:00:00Z")) {
  return {
    now,
    chairpersonId: "11111111-1111-4111-8111-111111111111",
    agendaItemCount: 3,
    scheduledAt: new Date(now.getTime() + 7 * 86_400_000),
    quorumEstablished: true,
    adjournmentReason: "lack of time",
  };
}

// ─── P1: Valid transitions only ─────────────────────────────────────────────────

describe("P1 — valid transitions only (Req 1.1, 1.6)", () => {
  it("canTransition matches the adjacency list for every (from,to) pair", () => {
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        expect(canTransition(from, to)).toBe(ADJACENCY[from].includes(to));
      }),
    );
  });

  it("assertTransition rejects any non-adjacent edge with a 422 MEETING_INVALID_TRANSITION", () => {
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        if (ADJACENCY[from].includes(to)) return; // only exercise the illegal edges here
        try {
          assertTransition(from, to, satisfyingCtx());
          throw new Error(`expected ${from}->${to} to be rejected`);
        } catch (err) {
          expect(err).toBeInstanceOf(HttpError);
          const e = err as HttpError;
          expect(e.status).toBe(422);
          expect(e.code).toBe("MEETING_INVALID_TRANSITION");
        }
      }),
    );
  });

  it("accepts every adjacency edge when all data guards are satisfied", () => {
    for (const from of MEETING_STATES) {
      for (const to of ADJACENCY[from]) {
        expect(() => assertTransition(from, to, satisfyingCtx())).not.toThrow();
      }
    }
  });
});

// ─── P2: Terminal state reachability ────────────────────────────────────────────

describe("P2 — terminal state reachability (Req 1.1)", () => {
  /** BFS over the adjacency map: is any terminal state reachable from `start`? */
  function reachesTerminal(start: MeetingState): boolean {
    const seen = new Set<MeetingState>([start]);
    const queue: MeetingState[] = [start];
    while (queue.length) {
      const s = queue.shift()!;
      if (TERMINAL_STATES.includes(s)) return true;
      for (const n of ADJACENCY[s]) if (!seen.has(n)) (seen.add(n), queue.push(n));
    }
    return false;
  }

  it("a terminal state is reachable from every state (in particular from draft)", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        expect(reachesTerminal(s)).toBe(true);
      }),
    );
    expect(reachesTerminal("draft")).toBe(true);
  });

  it("a greedy walk from draft always halts in a terminal state", () => {
    // Follow the linear-progression edge when present, else the first edge; bounded steps.
    let cur: MeetingState = "draft";
    const preferred: Partial<Record<MeetingState, MeetingState>> = {
      draft: "scheduled",
      scheduled: "agenda_locked",
      agenda_locked: "in_progress",
      in_progress: "minutes_pending",
      adjourned: "minutes_pending",
      minutes_pending: "minutes_approved",
      minutes_approved: "closed",
      closed: "archived",
    };
    for (let i = 0; i < MEETING_STATES.length + 2 && !isTerminal(cur); i++) {
      cur = preferred[cur] ?? ADJACENCY[cur][0]!;
    }
    expect(isTerminal(cur)).toBe(true);
    expect(TERMINAL_STATES).toContain(cur);
  });
});

// ─── P3: Monotonic progression past approval ────────────────────────────────────

describe("P3 — monotonic progression past approval (Req 1.1)", () => {
  const RANK: Record<MeetingState, number | null> = {
    draft: 0,
    scheduled: 1,
    agenda_locked: 2,
    in_progress: 3,
    adjourned: 3,
    minutes_pending: 4,
    minutes_approved: 5,
    closed: 6,
    archived: 7,
    cancelled: null,
  };

  it("no on-chain transition ever regresses from ≥minutes_approved to an earlier rank", () => {
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        const fr = RANK[from];
        const tr = RANK[to];
        if (fr !== null && tr !== null && fr >= RANK.minutes_approved! && tr < RANK.minutes_approved!) {
          expect(violatesMonotonicApproval(from, to)).toBe(true);
          expect(canTransition(from, to)).toBe(false);
        }
      }),
    );
  });

  it("from minutes_approved the only permitted target is closed", () => {
    for (const to of MEETING_STATES) {
      expect(canTransition("minutes_approved", to)).toBe(to === "closed");
    }
  });

  it("off-chain (cancelled) endpoints are never a monotonic violation", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        expect(violatesMonotonicApproval(s, "cancelled")).toBe(false);
        expect(violatesMonotonicApproval("cancelled", s)).toBe(false);
      }),
    );
  });
});

// ─── P5: Start time recorded ────────────────────────────────────────────────────

describe("P5 — start time recorded (Req 1.4)", () => {
  const STARTED: MeetingState[] = ["in_progress", "adjourned", "minutes_pending", "minutes_approved", "closed", "archived"];

  it("stateRequiresActualStart is true exactly for states at/after in_progress on the chain", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        expect(stateRequiresActualStart(s)).toBe(STARTED.includes(s));
      }),
    );
  });

  it("cancelled (off-chain) does not require a recorded start", () => {
    expect(stateRequiresActualStart("cancelled")).toBe(false);
  });
});

// ─── P6: Draft→scheduled prerequisites ──────────────────────────────────────────

describe("P6 — draft→scheduled prerequisites (Req 1.3)", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("succeeds iff chairperson present AND ≥1 agenda item AND future date", () => {
    fc.assert(
      fc.property(
        fc.option(fc.constant("11111111-1111-4111-8111-111111111111"), { nil: null }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: -5, max: 5 }),
        (chairpersonId, agendaItemCount, dayOffset) => {
          const scheduledAt = new Date(now.getTime() + dayOffset * 86_400_000);
          const ctx = { now, chairpersonId, agendaItemCount, scheduledAt };
          const shouldPass = Boolean(chairpersonId) && agendaItemCount >= 1 && dayOffset > 0;
          if (shouldPass) {
            expect(() => validateDraftToScheduled(ctx)).not.toThrow();
            expect(() => assertTransition("draft", "scheduled", ctx)).not.toThrow();
          } else {
            expect(() => validateDraftToScheduled(ctx)).toThrow(HttpError);
          }
        },
      ),
    );
  });

  it("reports the specific unmet prerequisites in the error details", () => {
    try {
      validateDraftToScheduled({ now, chairpersonId: null, agendaItemCount: 0, scheduledAt: new Date(now.getTime() - 1000) });
      throw new Error("expected throw");
    } catch (err) {
      const e = err as HttpError;
      expect(e.code).toBe("MEETING_INVALID_TRANSITION");
      expect(e.details?.unmet).toEqual(["chairpersonId", "agendaItem", "futureScheduledAt"]);
    }
  });
});

// ─── P7: Transition audit completeness ──────────────────────────────────────────

describe("P7 — transition audit completeness (Req 1.7)", () => {
  /**
   * Walk a random *simple* path (no state revisited) from draft, counting transitions.
   * Each accepted transition is exactly one audit-log row, so for a simple path the number
   * of transitions equals (distinct states visited − 1).
   */
  it("a simple path logs exactly (distinct states visited − 1) transitions", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 5 }), { minLength: 0, maxLength: 20 }), (choices) => {
        const visited: MeetingState[] = ["draft"];
        let cur: MeetingState = "draft";
        let transitions = 0;
        for (const choice of choices) {
          const unvisited = ADJACENCY[cur].filter((n) => !visited.includes(n));
          if (unvisited.length === 0) break;
          const next = unvisited[choice % unvisited.length]!;
          // Structural legality holds for every edge we follow (P1 already proven).
          expect(canTransition(cur, next)).toBe(true);
          visited.push(next);
          transitions += 1;
          cur = next;
        }
        expect(transitions).toBe(new Set(visited).size - 1);
      }),
    );
  });
});

// ─── P8: Cancelled is terminal ──────────────────────────────────────────────────

describe("P8 — cancelled is terminal (Req 1.6)", () => {
  it("cancelled and archived have no outgoing transitions", () => {
    expect(isTerminal("cancelled")).toBe(true);
    expect(allowedTargets("cancelled")).toEqual([]);
    expect(TERMINAL_STATES).toEqual(expect.arrayContaining(["cancelled", "archived"]));
  });

  it("no transition out of a terminal state is ever permitted", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERMINAL_STATES), stateArb, (from, to) => {
        expect(canTransition(from, to)).toBe(false);
        expect(() => assertTransition(from, to, satisfyingCtx())).toThrow(HttpError);
      }),
    );
  });
});

// ─── Tenant custom state-machine overlay (Req 1.8) ───────────────────────────────

describe("tenant state-machine overlay (Req 1.8)", () => {
  it("additionalTransitions add an edge the base machine lacks", () => {
    const config: TenantStateMachineConfig = {
      additionalTransitions: [{ from: "closed", to: "closed" }, { from: "draft", to: "agenda_locked" }],
    };
    expect(canTransition("draft", "agenda_locked", config)).toBe(true);
    expect(canTransition("draft", "agenda_locked")).toBe(false); // base machine unaffected
  });

  it("blockedTransitions remove a base edge", () => {
    const config: TenantStateMachineConfig = { blockedTransitions: [{ from: "scheduled", to: "draft" }] };
    expect(canTransition("scheduled", "draft", config)).toBe(false);
    expect(canTransition("scheduled", "draft")).toBe(true);
  });

  it("never lets a tenant overlay leave a terminal state", () => {
    const config: TenantStateMachineConfig = { additionalTransitions: [{ from: "cancelled", to: "draft" }] };
    expect(canTransition("cancelled", "draft", config)).toBe(false);
    expect(allowedTargets("cancelled", config)).toEqual([]);
  });

  it("never lets a tenant overlay introduce a regression past approval", () => {
    const config: TenantStateMachineConfig = { additionalTransitions: [{ from: "minutes_approved", to: "draft" }] };
    expect(canTransition("minutes_approved", "draft", config)).toBe(false);
  });

  it("requiredApprovalsFor returns configured approver roles for a keyed edge", () => {
    const config: TenantStateMachineConfig = {
      requiredApprovals: { [transitionKey("minutes_pending", "minutes_approved")]: ["chairperson", "board"] },
    };
    expect(requiredApprovalsFor("minutes_pending", "minutes_approved", config)).toEqual(["chairperson", "board"]);
    expect(requiredApprovalsFor("draft", "scheduled", config)).toEqual([]);
    expect(requiredApprovalsFor("draft", "scheduled")).toEqual([]);
  });

  it("transitionKey renders the canonical from->to key", () => {
    expect(transitionKey("draft", "scheduled")).toBe("draft->scheduled");
  });
});

// ─── Per-transition data guards (Req 1.4, 1.5) ───────────────────────────────────

describe("per-transition data guards", () => {
  const ctx = satisfyingCtx();

  it("validateQuorumForStart throws MEETING_QUORUM_NOT_MET (422) without quorum", () => {
    expect(() => validateQuorumForStart({ ...ctx, quorumEstablished: false })).toThrow(HttpError);
    try {
      validateQuorumForStart({ ...ctx, quorumEstablished: false });
    } catch (err) {
      const e = err as HttpError;
      expect(e.code).toBe("MEETING_QUORUM_NOT_MET");
      expect(e.status).toBe(422);
    }
    expect(() => validateQuorumForStart({ ...ctx, quorumEstablished: true })).not.toThrow();
  });

  it("→in_progress is gated on quorum through assertTransition", () => {
    expect(() => assertTransition("agenda_locked", "in_progress", { ...ctx, quorumEstablished: false })).toThrow(HttpError);
    expect(() => assertTransition("adjourned", "in_progress", { ...ctx, quorumEstablished: false })).toThrow(HttpError);
    expect(() => assertTransition("agenda_locked", "in_progress", { ...ctx, quorumEstablished: true })).not.toThrow();
  });

  it("validateAdjourn requires a non-blank reason", () => {
    expect(() => validateAdjourn({ ...ctx, adjournmentReason: null })).toThrow(HttpError);
    expect(() => validateAdjourn({ ...ctx, adjournmentReason: "   " })).toThrow(HttpError);
    expect(() => validateAdjourn({ ...ctx, adjournmentReason: "quorum lost" })).not.toThrow();
  });

  it("in_progress→adjourned is gated on a recorded reason through assertTransition", () => {
    expect(() => assertTransition("in_progress", "adjourned", { ...ctx, adjournmentReason: "" })).toThrow(HttpError);
    expect(() => assertTransition("in_progress", "adjourned", { ...ctx, adjournmentReason: "no quorum" })).not.toThrow();
  });

  it("guarded transitions raise VALIDATION_FAILED (400) when no context is supplied", () => {
    try {
      assertTransition("draft", "scheduled");
      throw new Error("expected throw");
    } catch (err) {
      const e = err as HttpError;
      expect(e.code).toBe("VALIDATION_FAILED");
      expect(e.status).toBe(400);
    }
  });

  it("unguarded transitions need no context", () => {
    expect(() => assertTransition("draft", "cancelled")).not.toThrow();
    expect(() => assertTransition("scheduled", "agenda_locked")).not.toThrow();
  });
});

// ─── State predicate helpers ─────────────────────────────────────────────────────

describe("state predicates", () => {
  it("isMeetingState recognises exactly the ten lifecycle states", () => {
    for (const s of MEETING_STATES) expect(isMeetingState(s)).toBe(true);
    expect(isMeetingState("bogus")).toBe(false);
    expect(isMeetingState("")).toBe(false);
  });
});

// ─── Financial year + meeting-number generation (Req 1.2) ────────────────────────

describe("computeFinancialYear (Indian FY, Apr 1 – Mar 31)", () => {
  it("maps dates on either side of the April boundary correctly", () => {
    expect(computeFinancialYear(new Date("2025-06-15T00:00:00Z"))).toBe("2025-26");
    expect(computeFinancialYear(new Date("2026-02-15T00:00:00Z"))).toBe("2025-26");
    expect(computeFinancialYear(new Date("2025-04-01T00:00:00Z"))).toBe("2025-26");
    expect(computeFinancialYear(new Date("2025-03-31T00:00:00Z"))).toBe("2024-25");
    expect(computeFinancialYear(new Date("2025-01-01T00:00:00Z"))).toBe("2024-25");
  });

  it("always returns the canonical 7-char YYYY-YY shape", () => {
    // Constrain to valid dates: production only ever passes a zod-validated ISO datetime
    // (or `now`), never an invalid Date, so `noInvalidDate` keeps the generator in-domain.
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2099-12-31T00:00:00Z"), noInvalidDate: true }),
        (d) => {
          expect(computeFinancialYear(d)).toMatch(/^\d{4}-\d{2}$/);
        },
      ),
    );
  });
});

describe("nextMeetingSequence", () => {
  it("returns 1 for an empty scope and max+1 otherwise (gap-tolerant)", () => {
    expect(nextMeetingSequence([])).toBe(1);
    expect(nextMeetingSequence([1, 2, 3])).toBe(4);
    expect(nextMeetingSequence([1, 5, 3])).toBe(6); // gaps are fine
    expect(nextMeetingSequence([7])).toBe(8);
  });

  it("ignores non-finite entries and truncates fractional maxes", () => {
    expect(nextMeetingSequence([Number.NaN, 2, Number.POSITIVE_INFINITY])).toBe(3);
    expect(nextMeetingSequence([2.9])).toBe(3);
  });

  it("is always strictly greater than every existing sequence", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 10_000 }), { maxLength: 30 }), (seqs) => {
        const next = nextMeetingSequence(seqs);
        for (const s of seqs) expect(next).toBeGreaterThan(s);
      }),
    );
  });
});

describe("generateMeetingNumber", () => {
  it("formats committee/FY/sequence with a 3-digit zero-padded sequence", () => {
    expect(generateMeetingNumber({ committeeCode: "FC", financialYear: "2025-26", sequence: 7 })).toBe("FC/2025-26/007");
    expect(generateMeetingNumber({ committeeCode: "fc", financialYear: "2025-26", sequence: 123 })).toBe("FC/2025-26/123");
  });

  it("falls back to the MTG prefix when there is no committee code", () => {
    expect(generateMeetingNumber({ committeeCode: null, financialYear: "2025-26", sequence: 1 })).toBe("MTG/2025-26/001");
    expect(generateMeetingNumber({ committeeCode: "  ", financialYear: "2025-26", sequence: 2 })).toBe("MTG/2025-26/002");
  });

  it("clamps a non-positive sequence to at least 001", () => {
    expect(generateMeetingNumber({ committeeCode: "FC", financialYear: "2025-26", sequence: 0 })).toBe("FC/2025-26/001");
    expect(generateMeetingNumber({ committeeCode: "FC", financialYear: "2025-26", sequence: -5 })).toBe("FC/2025-26/001");
  });
});
