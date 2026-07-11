/**
 * decision module — domain property + branch-coverage tests (task 10.4).
 *
 * Task 10.4 property coverage against `src/modules/decision/domain.ts`:
 *   - P25 Resolution number uniqueness — within the same committee + financial year, the
 *     resolution number is unique and sequential (`nextResolutionSequence` /
 *     `generateResolutionNumber` / `resolutionFinancialYear`).
 *   - P18 Circulation validity — a circulation resolution is valid only when the response rate
 *     meets the configured minimum, otherwise its result is `invalid` (`requiredResponseCount` /
 *     `circulationResponseRate` / `isCirculationResponseSufficient` / `computeCirculationResult` /
 *     `assertCirculationValid`).
 *
 * fast-check is not a dependency of this service and no sibling meeting-service test uses it, so
 * per the task guidance these are thorough example + generated-input tests: each property is
 * exercised across many deterministic pseudo-random inputs (seeded `mulberry32`, reproducible)
 * plus explicit boundary examples. The remaining pure helpers (vote-result computation, lineage
 * acyclicity, supersede planning, typed ERP routing) are covered for all branches so the decision
 * domain reaches full line/branch coverage.
 *
 * **Validates: Requirements 11.4, 12.2, 12.5**
 */
import { describe, it, expect } from "vitest";
import { HttpError } from "../src/shared/context.js";
import { EVENTS } from "../src/topics.js";
import {
  DECISION_TYPES,
  MAJORITY_RULES,
  resolutionFinancialYear,
  nextResolutionSequence,
  generateResolutionNumber,
  totalVotes,
  computeVoteResult,
  DEFAULT_CIRCULATION_MIN_RESPONSE_RATE_PCT,
  requiredResponseCount,
  circulationResponseRate,
  isCirculationResponseSufficient,
  computeCirculationResult,
  assertCirculationValid,
  hasLineageCycle,
  wouldCreateCycle,
  assertAcyclicLineage,
  buildSupersedePlan,
  routeDecisionEvents,
  isErpRoutableDecision,
  type MajorityRule,
  type LineageEdge,
} from "../src/modules/decision/domain.js";

// ─── Deterministic PRNG (reproducible property-style loops, no fast-check dep) ──

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

const RUNS = 500;

describe("resolutionFinancialYear (April–March boundary, shared with meeting-core)", () => {
  it("maps dates to the canonical YYYY-YY financial year", () => {
    expect(resolutionFinancialYear(new Date("2025-06-15T00:00:00Z"))).toBe("2025-26");
    expect(resolutionFinancialYear(new Date("2026-02-01T00:00:00Z"))).toBe("2025-26");
    expect(resolutionFinancialYear(new Date("2025-04-01T00:00:00Z"))).toBe("2025-26");
    expect(resolutionFinancialYear(new Date("2025-03-31T00:00:00Z"))).toBe("2024-25");
  });
});

describe("P25: resolution number uniqueness + sequential per committee + FY", () => {
  it("nextResolutionSequence returns max+1 and is gap-tolerant", () => {
    expect(nextResolutionSequence([])).toBe(1);
    expect(nextResolutionSequence([1, 2, 3])).toBe(4);
    expect(nextResolutionSequence([1, 5, 3])).toBe(6); // gaps tolerated → max+1
    expect(nextResolutionSequence([7])).toBe(8);
    // Non-finite / non-positive values are ignored.
    expect(nextResolutionSequence([NaN, -3, 2])).toBe(3);
    expect(nextResolutionSequence([2.9])).toBe(3); // truncated
  });

  it("issuing sequentially yields strictly increasing, unique numbers within a (committee, FY)", () => {
    const rand = mulberry32(0x25a);
    for (let run = 0; run < 100; run++) {
      const committeeCode = ["FC", "AC", "GB", null][Math.floor(rand() * 4)] as string | null;
      const financialYear = ["2025-26", "2024-25"][Math.floor(rand() * 2)]!;
      const issued: number[] = [];
      const numbers = new Set<string>();
      const count = 1 + Math.floor(rand() * 25);
      for (let i = 0; i < count; i++) {
        const seq = nextResolutionSequence(issued);
        // Sequential: each issued sequence is exactly one past the running max.
        expect(seq).toBe(issued.length === 0 ? 1 : Math.max(...issued) + 1);
        const number = generateResolutionNumber({ committeeCode, financialYear, sequence: seq });
        // Unique within the scope.
        expect(numbers.has(number)).toBe(false);
        numbers.add(number);
        issued.push(seq);
      }
      expect(numbers.size).toBe(count);
    }
  });

  it("generateResolutionNumber formats the canonical committee/RES/FY/seq number", () => {
    expect(generateResolutionNumber({ committeeCode: "FC", financialYear: "2025-26", sequence: 7 })).toBe(
      "FC/RES/2025-26/007",
    );
    // Lower-case + whitespace normalised to upper-case.
    expect(generateResolutionNumber({ committeeCode: " fc ", financialYear: "2025-26", sequence: 1 })).toBe(
      "FC/RES/2025-26/001",
    );
    // Missing committee code → RES prefix fallback.
    expect(generateResolutionNumber({ committeeCode: null, financialYear: "2025-26", sequence: 12 })).toBe(
      "RES/RES/2025-26/012",
    );
    expect(generateResolutionNumber({ financialYear: "2025-26", sequence: 3 })).toBe("RES/RES/2025-26/003");
    // Sequence floored to at least 1 and zero-padded to 3 digits; large values keep full width.
    expect(generateResolutionNumber({ committeeCode: "FC", financialYear: "2025-26", sequence: 0 })).toBe(
      "FC/RES/2025-26/001",
    );
    expect(generateResolutionNumber({ committeeCode: "FC", financialYear: "2025-26", sequence: 1234 })).toBe(
      "FC/RES/2025-26/1234",
    );
  });

  it("different committees or FYs never collide on the same sequence", () => {
    const a = generateResolutionNumber({ committeeCode: "FC", financialYear: "2025-26", sequence: 1 });
    const b = generateResolutionNumber({ committeeCode: "AC", financialYear: "2025-26", sequence: 1 });
    const c = generateResolutionNumber({ committeeCode: "FC", financialYear: "2024-25", sequence: 1 });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("vote-result computation (Req 11.3, P16 — abstain excluded from base)", () => {
  it("totalVotes sums the three counts, normalising junk to 0", () => {
    expect(totalVotes({ votesFor: 2, votesAgainst: 1, votesAbstain: 3 })).toBe(6);
    expect(totalVotes({ votesFor: -1, votesAgainst: NaN, votesAbstain: 2 })).toBe(2);
  });

  it("decisive base = for + against (abstentions do not count toward the majority)", () => {
    // 2 for, 1 against, 10 abstain → simple majority passes on decisive votes only.
    expect(
      computeVoteResult({ votesFor: 2, votesAgainst: 1, votesAbstain: 10 }, "simple_majority"),
    ).toBe("passed");
    // two_thirds on decisive base: 2 of 3 decisive → passes despite abstentions.
    expect(computeVoteResult({ votesFor: 2, votesAgainst: 1, votesAbstain: 5 }, "two_thirds")).toBe("passed");
    // three_fourths: 3 of 4 decisive passes.
    expect(computeVoteResult({ votesFor: 3, votesAgainst: 1, votesAbstain: 0 }, "three_fourths")).toBe("passed");
  });

  it("unanimous requires every ballot for (no against, no abstain)", () => {
    expect(computeVoteResult({ votesFor: 4, votesAgainst: 0, votesAbstain: 0 }, "unanimous")).toBe("passed");
    expect(computeVoteResult({ votesFor: 4, votesAgainst: 0, votesAbstain: 1 }, "unanimous")).toBe("rejected");
    expect(computeVoteResult({ votesFor: 0, votesAgainst: 0, votesAbstain: 0 }, "unanimous")).toBe("rejected");
  });

  it("no decisive votes → rejected under every rule", () => {
    for (const rule of MAJORITY_RULES) {
      expect(computeVoteResult({ votesFor: 0, votesAgainst: 0, votesAbstain: 9 }, rule)).toBe("rejected");
    }
  });

  it("throws on an unknown majority rule", () => {
    expect(() =>
      computeVoteResult({ votesFor: 1, votesAgainst: 0, votesAbstain: 0 }, "plurality" as unknown as MajorityRule),
    ).toThrow(HttpError);
  });
});

describe("P18: circulation validity (threshold, response rate, outcome)", () => {
  it("DEFAULT_CIRCULATION_MIN_RESPONSE_RATE_PCT is exactly two-thirds", () => {
    expect(DEFAULT_CIRCULATION_MIN_RESPONSE_RATE_PCT).toBeCloseTo(200 / 3, 10);
  });

  it("requiredResponseCount = ceil(members * minPct/100); default two-thirds examples", () => {
    expect(requiredResponseCount(0)).toBe(0); // nobody to respond
    expect(requiredResponseCount(3)).toBe(2); // ceil(3 * 2/3) = 2
    expect(requiredResponseCount(6)).toBe(4); // ceil(6 * 2/3) = 4
    expect(requiredResponseCount(10)).toBe(7); // ceil(10 * 2/3) = 7
    // Configurable minimum; out-of-range pct falls back to the two-thirds default.
    expect(requiredResponseCount(10, { minResponseRatePct: 50 })).toBe(5);
    expect(requiredResponseCount(10, { minResponseRatePct: 100 })).toBe(10);
    expect(requiredResponseCount(10, { minResponseRatePct: -5 })).toBe(7); // invalid → default
    expect(requiredResponseCount(10, { minResponseRatePct: 150 })).toBe(7); // invalid → default
  });

  it("circulationResponseRate is the rounded integer percentage, capped and 0 for empty", () => {
    expect(circulationResponseRate(0, 0)).toBe(0);
    expect(circulationResponseRate(1, 3)).toBe(33);
    expect(circulationResponseRate(2, 3)).toBe(67);
    expect(circulationResponseRate(3, 3)).toBe(100);
    // Responded is clamped to the member count (never > 100%).
    expect(circulationResponseRate(9, 3)).toBe(100);
  });

  it("isCirculationResponseSufficient IFF responded ≥ requiredResponseCount", () => {
    const rand = mulberry32(0x18b);
    for (let i = 0; i < RUNS; i++) {
      const totalMembers = Math.floor(rand() * 20);
      const responded = Math.floor(rand() * 20);
      const required = requiredResponseCount(totalMembers);
      const sufficient = totalMembers > 0 && responded >= required;
      expect(isCirculationResponseSufficient(responded, totalMembers)).toBe(sufficient);
    }
    // A committee with no members can never be sufficient.
    expect(isCirculationResponseSufficient(0, 0)).toBe(false);
  });

  it("computeCirculationResult: invalid when under threshold (P18), else majority outcome", () => {
    // 6 members, only 3 respond (< required 4) → invalid regardless of the approve/reject split.
    const under = computeCirculationResult({
      approveCount: 3,
      rejectCount: 0,
      abstainCount: 0,
      totalMembers: 6,
      majorityRule: "simple_majority",
    });
    expect(under).toEqual({ valid: false, responseRate: 50, result: "invalid" });

    // 6 members, 4 respond (meets required 4), 3 approve / 1 reject → passes simple majority.
    const passed = computeCirculationResult({
      approveCount: 3,
      rejectCount: 1,
      abstainCount: 0,
      totalMembers: 6,
      majorityRule: "simple_majority",
    });
    expect(passed.valid).toBe(true);
    expect(passed.responseRate).toBe(67);
    expect(passed.result).toBe("passed");

    // Valid threshold but rejected by the rule.
    const rejected = computeCirculationResult({
      approveCount: 1,
      rejectCount: 3,
      abstainCount: 0,
      totalMembers: 6,
      majorityRule: "simple_majority",
    });
    expect(rejected.valid).toBe(true);
    expect(rejected.result).toBe("rejected");
  });

  it("a valid circulation is never `invalid`; an invalid one is always `invalid` (property)", () => {
    const rand = mulberry32(0x18c);
    for (let i = 0; i < RUNS; i++) {
      const totalMembers = 1 + Math.floor(rand() * 12);
      const approve = Math.floor(rand() * (totalMembers + 1));
      const reject = Math.floor(rand() * (totalMembers + 1 - Math.min(approve, totalMembers)));
      const abstain = Math.floor(rand() * 3);
      const rule = MAJORITY_RULES[Math.floor(rand() * MAJORITY_RULES.length)]!;
      const outcome = computeCirculationResult({
        approveCount: approve,
        rejectCount: reject,
        abstainCount: abstain,
        totalMembers,
        majorityRule: rule,
      });
      const responded = approve + reject + abstain;
      const sufficient = isCirculationResponseSufficient(responded, totalMembers);
      expect(outcome.valid).toBe(sufficient);
      if (!sufficient) {
        expect(outcome.result).toBe("invalid");
      } else {
        expect(outcome.result).not.toBe("invalid");
        expect(["passed", "rejected"]).toContain(outcome.result);
      }
    }
  });

  it("assertCirculationValid passes when sufficient and throws 422 otherwise", () => {
    expect(() => assertCirculationValid({ respondedCount: 4, totalMembers: 6 })).not.toThrow();
    try {
      assertCirculationValid({ respondedCount: 3, totalMembers: 6 });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(422);
      expect((err as HttpError).code).toBe("RESOLUTION_CIRCULATION_INVALID");
      expect((err as HttpError).details).toMatchObject({ requiredCount: 4, totalMembers: 6 });
    }
  });
});

describe("supersede / lineage acyclicity (Req 11.8, 17.4)", () => {
  it("detects self-loops and cycles", () => {
    expect(hasLineageCycle([{ from: "a", to: "a" }])).toBe(true);
    expect(hasLineageCycle([{ from: "a", to: "b" }, { from: "b", to: "c" }])).toBe(false);
    expect(
      hasLineageCycle([
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ]),
    ).toBe(true);
    expect(hasLineageCycle([])).toBe(false);
  });

  it("wouldCreateCycle predicts the effect of adding an edge", () => {
    const existing: LineageEdge[] = [{ from: "b", to: "a" }];
    expect(wouldCreateCycle(existing, "a", "b")).toBe(true); // a→b closes b→a
    expect(wouldCreateCycle(existing, "c", "a")).toBe(false);
  });

  it("assertAcyclicLineage throws 400 on self-link and on a cycle", () => {
    expect(() => assertAcyclicLineage([], { from: "a", to: "b" })).not.toThrow();
    try {
      assertAcyclicLineage([], { from: "a", to: "a" });
      throw new Error("expected self-link throw");
    } catch (err) {
      expect((err as HttpError).status).toBe(400);
      expect((err as HttpError).code).toBe("VALIDATION_FAILED");
    }
    try {
      assertAcyclicLineage([{ from: "b", to: "a" }], { from: "a", to: "b", relation: "amends" });
      throw new Error("expected cycle throw");
    } catch (err) {
      expect((err as HttpError).code).toBe("VALIDATION_FAILED");
      expect((err as HttpError).details).toMatchObject({ relation: "amends" });
    }
  });

  it("buildSupersedePlan produces the status update + lineage edge, guarding acyclicity", () => {
    const plan = buildSupersedePlan({ supersedingId: "new", supersededId: "old" });
    expect(plan.supersededUpdate).toEqual({ id: "old", status: "superseded", supersededById: "new" });
    expect(plan.lineageEdge).toEqual({ from: "new", to: "old", relation: "supersedes" });
    // A plan that would close a cycle is rejected.
    expect(() =>
      buildSupersedePlan({ supersedingId: "old", supersededId: "new", existingLineage: [{ from: "new", to: "old" }] }),
    ).toThrow(HttpError);
    // Self-supersession is rejected.
    expect(() => buildSupersedePlan({ supersedingId: "x", supersededId: "x" })).toThrow(HttpError);
  });
});

describe("typed ERP-event routing (Req 22.1–22.5)", () => {
  it("every decision emits the generic fact; ERP types add their dedicated event", () => {
    expect(routeDecisionEvents("administrative")).toEqual([EVENTS.decisionRecorded]);
    expect(routeDecisionEvents("general")).toEqual([EVENTS.decisionRecorded]);
    expect(routeDecisionEvents("procurement")).toEqual([EVENTS.decisionRecorded, EVENTS.decisionProcurement]);
    expect(routeDecisionEvents("financial")).toEqual([EVENTS.decisionRecorded, EVENTS.decisionFinancial]);
    expect(routeDecisionEvents("hr")).toEqual([EVENTS.decisionRecorded, EVENTS.decisionHr]);
    expect(routeDecisionEvents("project")).toEqual([EVENTS.decisionRecorded, EVENTS.decisionProject]);
    expect(routeDecisionEvents("legal")).toEqual([EVENTS.decisionRecorded, EVENTS.decisionLegal]);
    // Unknown type → generic only.
    expect(routeDecisionEvents("something-else")).toEqual([EVENTS.decisionRecorded]);
  });

  it("isErpRoutableDecision agrees with the routing table", () => {
    for (const type of DECISION_TYPES) {
      const routable = ["procurement", "financial", "hr", "project", "legal"].includes(type);
      expect(isErpRoutableDecision(type)).toBe(routable);
      // The generic fact is always present regardless of routability.
      expect(routeDecisionEvents(type)[0]).toBe(EVENTS.decisionRecorded);
      expect(routeDecisionEvents(type).length).toBe(routable ? 2 : 1);
    }
    expect(isErpRoutableDecision("unknown")).toBe(false);
  });
});
