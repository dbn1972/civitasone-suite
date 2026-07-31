/**
 * recommendation-service domain unit tests — pure functions, no IO.
 * Covers scoring, ranking, the status state machine, TTL expiry, matrix
 * validation/duplicate detection, health scoring/banding and feedback rules.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TTL_HOURS,
  MAX_MATRIX_PRIORITY,
  RECOMMENDATION_STATUSES,
  SCORE_WEIGHTS,
  TERMINAL_STATUSES,
  isExpired,
  isRecommendationStatus,
  isTerminalStatus,
  rankRecommendations,
  scoreRecommendation,
  ttlCutoff,
  validateStatusTransition,
} from "../src/modules/nba/domain.js";
import {
  MAX_SCOPE_LENGTH,
  detectDuplicate,
  matrixKeyOf,
  normaliseScopeValue,
  validateMatrixEntry,
  type MatrixEntryInput,
} from "../src/modules/matrix/domain.js";
import {
  HEALTH_FACTOR_NAMES,
  HEALTH_WEIGHTS,
  classifyHealth,
  computeHealthScore,
  validateFactors,
  type HealthFactors,
} from "../src/modules/health/domain.js";
import {
  FEEDBACK_ACTIONS,
  MAX_REASON_LENGTH,
  isFeedbackAction,
  isTerminalAction,
  normaliseReason,
  validateFeedback,
} from "../src/modules/feedback/domain.js";

// ── nba/domain: constants ─────────────────────────────────────────────────────

describe("nba/domain constants", () => {
  it("score weights sum to 1", () => {
    const total = SCORE_WEIGHTS.matrixPriority + SCORE_WEIGHTS.healthScore + SCORE_WEIGHTS.affinity;
    expect(total).toBeCloseTo(1, 10);
  });

  it("lists exactly four statuses", () => {
    expect(RECOMMENDATION_STATUSES).toEqual(["served", "accepted", "rejected", "expired"]);
  });

  it("treats every status except served as terminal", () => {
    expect(TERMINAL_STATUSES).toEqual(["accepted", "rejected", "expired"]);
  });

  it("uses a positive default TTL", () => {
    expect(DEFAULT_TTL_HOURS).toBeGreaterThan(0);
  });
});

// ── nba/domain: scoreRecommendation ───────────────────────────────────────────

describe("scoreRecommendation", () => {
  it("returns 1 when every signal is at maximum", () => {
    expect(scoreRecommendation({ matrixPriority: MAX_MATRIX_PRIORITY, healthScore: 100, affinity: 1 })).toBe(1);
  });

  it("returns 0 when every signal is at minimum", () => {
    expect(scoreRecommendation({ matrixPriority: 0, healthScore: 0, affinity: 0 })).toBe(0);
  });

  it("returns 0.5 when every signal is mid-range", () => {
    expect(scoreRecommendation({ matrixPriority: 5, healthScore: 50, affinity: 0.5 })).toBe(0.5);
  });

  it("weights matrix priority most heavily", () => {
    const priorityOnly = scoreRecommendation({ matrixPriority: MAX_MATRIX_PRIORITY, healthScore: 0, affinity: 0 });
    const healthOnly = scoreRecommendation({ matrixPriority: 0, healthScore: 100, affinity: 0 });
    const affinityOnly = scoreRecommendation({ matrixPriority: 0, healthScore: 0, affinity: 1 });
    expect(priorityOnly).toBe(SCORE_WEIGHTS.matrixPriority);
    expect(healthOnly).toBe(SCORE_WEIGHTS.healthScore);
    expect(affinityOnly).toBe(SCORE_WEIGHTS.affinity);
    expect(priorityOnly).toBeGreaterThan(affinityOnly);
    expect(affinityOnly).toBeGreaterThan(healthOnly);
  });

  it("caps matrix priority above the maximum", () => {
    const capped = scoreRecommendation({ matrixPriority: 500, healthScore: 0, affinity: 0 });
    expect(capped).toBe(SCORE_WEIGHTS.matrixPriority);
  });

  it("clamps negative inputs to zero", () => {
    expect(scoreRecommendation({ matrixPriority: -5, healthScore: -20, affinity: -1 })).toBe(0);
  });

  it("clamps health above 100 and affinity above 1", () => {
    expect(scoreRecommendation({ matrixPriority: 0, healthScore: 900, affinity: 9 })).toBe(
      SCORE_WEIGHTS.healthScore + SCORE_WEIGHTS.affinity,
    );
  });

  it("treats NaN signals as zero", () => {
    expect(scoreRecommendation({ matrixPriority: NaN, healthScore: NaN, affinity: NaN })).toBe(0);
  });

  it("treats Infinity as the capped maximum", () => {
    expect(scoreRecommendation({ matrixPriority: Infinity, healthScore: 0, affinity: 0 })).toBe(0);
  });

  it("rounds to at most 4 decimal places", () => {
    const score = scoreRecommendation({ matrixPriority: 1, healthScore: 1, affinity: 1 / 3 });
    expect(Number.isInteger(Math.round(score * 10_000))).toBe(true);
    expect(score).toBe(Math.round(score * 10_000) / 10_000);
  });

  it("never returns a value outside 0..1", () => {
    const samples = [
      { matrixPriority: 1e9, healthScore: 1e9, affinity: 1e9 },
      { matrixPriority: -1e9, healthScore: -1e9, affinity: -1e9 },
      { matrixPriority: 3, healthScore: 77, affinity: 0.42 },
    ];
    for (const sample of samples) {
      const score = scoreRecommendation(sample);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ── nba/domain: rankRecommendations ───────────────────────────────────────────

describe("rankRecommendations", () => {
  const items = [
    { id: "a", score: 0.2, priority: 1 },
    { id: "b", score: 0.9, priority: 1 },
    { id: "c", score: 0.5, priority: 1 },
  ];

  it("sorts by score descending", () => {
    expect(rankRecommendations(items, 10).map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("caps the result at the limit", () => {
    expect(rankRecommendations(items, 2).map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("breaks ties on priority descending", () => {
    const tied = [
      { id: "low", score: 0.5, priority: 1 },
      { id: "high", score: 0.5, priority: 9 },
    ];
    expect(rankRecommendations(tied, 5).map((i) => i.id)).toEqual(["high", "low"]);
  });

  it("treats a missing priority as zero", () => {
    const tied = [{ id: "none", score: 0.5 }, { id: "some", score: 0.5, priority: 3 }];
    expect(rankRecommendations(tied, 5).map((i) => i.id)).toEqual(["some", "none"]);
  });

  it("keeps the original order for fully tied items", () => {
    const tied = [
      { id: "first", score: 0.5, priority: 2 },
      { id: "second", score: 0.5, priority: 2 },
    ];
    expect(rankRecommendations(tied, 5).map((i) => i.id)).toEqual(["first", "second"]);
  });

  it("treats a NaN score as zero", () => {
    const messy = [{ id: "nan", score: NaN }, { id: "ok", score: 0.1 }];
    expect(rankRecommendations(messy, 5).map((i) => i.id)).toEqual(["ok", "nan"]);
  });

  it("returns an empty array for limit 0", () => {
    expect(rankRecommendations(items, 0)).toEqual([]);
  });

  it("returns an empty array for a negative limit", () => {
    expect(rankRecommendations(items, -3)).toEqual([]);
  });

  it("returns an empty array for a non-finite limit", () => {
    expect(rankRecommendations(items, NaN)).toEqual([]);
  });

  it("floors a fractional limit", () => {
    expect(rankRecommendations(items, 2.9)).toHaveLength(2);
  });

  it("returns an empty array for empty input", () => {
    expect(rankRecommendations([], 5)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const original = [...items];
    rankRecommendations(items, 5);
    expect(items).toEqual(original);
  });

  it("returns all items when the limit exceeds the input length", () => {
    expect(rankRecommendations(items, 100)).toHaveLength(3);
  });
});

// ── nba/domain: status helpers ────────────────────────────────────────────────

describe("isRecommendationStatus / isTerminalStatus", () => {
  it("accepts every known status", () => {
    for (const status of RECOMMENDATION_STATUSES) {
      expect(isRecommendationStatus(status)).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    expect(isRecommendationStatus("archived")).toBe(false);
  });

  it("rejects an empty status", () => {
    expect(isRecommendationStatus("")).toBe(false);
  });

  it("treats served as non-terminal", () => {
    expect(isTerminalStatus("served")).toBe(false);
  });

  it("treats accepted, rejected and expired as terminal", () => {
    expect(isTerminalStatus("accepted")).toBe(true);
    expect(isTerminalStatus("rejected")).toBe(true);
    expect(isTerminalStatus("expired")).toBe(true);
  });

  it("treats an unknown status as non-terminal", () => {
    expect(isTerminalStatus("nonsense")).toBe(false);
  });
});

// ── nba/domain: validateStatusTransition ──────────────────────────────────────

describe("validateStatusTransition", () => {
  it("allows served → accepted", () => {
    expect(validateStatusTransition("served", "accepted")).toBeNull();
  });

  it("allows served → rejected", () => {
    expect(validateStatusTransition("served", "rejected")).toBeNull();
  });

  it("allows served → expired", () => {
    expect(validateStatusTransition("served", "expired")).toBeNull();
  });

  it("rejects served → served", () => {
    expect(validateStatusTransition("served", "served")).toContain("already served");
  });

  it("rejects accepted → rejected", () => {
    expect(validateStatusTransition("accepted", "rejected")).toContain("already accepted");
  });

  it("rejects rejected → accepted", () => {
    expect(validateStatusTransition("rejected", "accepted")).toContain("already rejected");
  });

  it("rejects expired → accepted", () => {
    expect(validateStatusTransition("expired", "accepted")).toContain("already expired");
  });

  it("rejects an unknown current status", () => {
    expect(validateStatusTransition("archived", "accepted")).toBe("unknown current status: archived");
  });

  it("rejects an unknown target status", () => {
    expect(validateStatusTransition("served", "archived")).toBe("unknown target status: archived");
  });

  it("rejects empty statuses", () => {
    expect(validateStatusTransition("", "")).toBe("unknown current status: ");
  });

  it("checks the current status before the target status", () => {
    expect(validateStatusTransition("bogus", "alsoBogus")).toContain("current");
  });
});

// ── nba/domain: isExpired / ttlCutoff ─────────────────────────────────────────

describe("isExpired", () => {
  const now = new Date("2026-01-10T12:00:00.000Z");

  it("is false inside the TTL window", () => {
    const servedAt = new Date(now.getTime() - 1 * 3_600_000);
    expect(isExpired(servedAt, 72, now)).toBe(false);
  });

  it("is true past the TTL window", () => {
    const servedAt = new Date(now.getTime() - 100 * 3_600_000);
    expect(isExpired(servedAt, 72, now)).toBe(true);
  });

  it("is true exactly at the TTL boundary", () => {
    const servedAt = new Date(now.getTime() - 72 * 3_600_000);
    expect(isExpired(servedAt, 72, now)).toBe(true);
  });

  it("accepts an ISO string", () => {
    expect(isExpired("2026-01-01T12:00:00.000Z", 72, now)).toBe(true);
  });

  it("is false for an unparseable date", () => {
    expect(isExpired("not-a-date", 72, now)).toBe(false);
  });

  it("is false when the TTL is zero (never expires)", () => {
    const servedAt = new Date(now.getTime() - 10_000 * 3_600_000);
    expect(isExpired(servedAt, 0, now)).toBe(false);
  });

  it("is false when the TTL is negative", () => {
    expect(isExpired(new Date(0), -1, now)).toBe(false);
  });

  it("is false when the TTL is not finite", () => {
    expect(isExpired(new Date(0), NaN, now)).toBe(false);
  });

  it("defaults to the service TTL", () => {
    const servedAt = new Date(now.getTime() - (DEFAULT_TTL_HOURS + 1) * 3_600_000);
    expect(isExpired(servedAt, undefined, now)).toBe(true);
  });

  it("is false for a future servedAt", () => {
    const servedAt = new Date(now.getTime() + 3_600_000);
    expect(isExpired(servedAt, 72, now)).toBe(false);
  });
});

describe("ttlCutoff", () => {
  const now = new Date("2026-01-10T12:00:00.000Z");

  it("subtracts the given hours from now", () => {
    expect(ttlCutoff(24, now).toISOString()).toBe("2026-01-09T12:00:00.000Z");
  });

  it("falls back to the default TTL for a non-positive value", () => {
    expect(ttlCutoff(0, now).getTime()).toBe(now.getTime() - DEFAULT_TTL_HOURS * 3_600_000);
  });

  it("falls back to the default TTL for a non-finite value", () => {
    expect(ttlCutoff(NaN, now).getTime()).toBe(now.getTime() - DEFAULT_TTL_HOURS * 3_600_000);
  });
});

// ── matrix/domain: normaliseScopeValue / matrixKeyOf ──────────────────────────

describe("normaliseScopeValue", () => {
  it("maps undefined to an empty string", () => {
    expect(normaliseScopeValue(undefined)).toBe("");
  });

  it("maps null to an empty string", () => {
    expect(normaliseScopeValue(null)).toBe("");
  });

  it("trims and lowercases", () => {
    expect(normaliseScopeValue("  Retail  ")).toBe("retail");
  });

  it("leaves an already normalised value unchanged", () => {
    expect(normaliseScopeValue("web")).toBe("web");
  });

  it("maps a blank string to an empty string", () => {
    expect(normaliseScopeValue("   ")).toBe("");
  });
});

describe("matrixKeyOf", () => {
  it("produces the same key for null and undefined scopes", () => {
    const a = matrixKeyOf({ triggerProductId: "t", recommendedProductId: "r", segment: null, channel: null });
    const b = matrixKeyOf({ triggerProductId: "t", recommendedProductId: "r" });
    expect(a).toBe(b);
  });

  it("produces different keys for different segments", () => {
    const a = matrixKeyOf({ triggerProductId: "t", recommendedProductId: "r", segment: "sme" });
    const b = matrixKeyOf({ triggerProductId: "t", recommendedProductId: "r", segment: "retail" });
    expect(a).not.toBe(b);
  });
});

// ── matrix/domain: validateMatrixEntry ────────────────────────────────────────

describe("validateMatrixEntry", () => {
  const base: MatrixEntryInput = {
    triggerProductId: "11111111-1111-4111-8111-111111111111",
    recommendedProductId: "22222222-2222-4222-8222-222222222222",
    priority: 5,
  };

  it("accepts a minimal valid entry", () => {
    expect(validateMatrixEntry(base)).toBeNull();
  });

  it("accepts priority 0", () => {
    expect(validateMatrixEntry({ ...base, priority: 0 })).toBeNull();
  });

  it("accepts optional segment and channel", () => {
    expect(validateMatrixEntry({ ...base, segment: "sme", channel: "web" })).toBeNull();
  });

  it("accepts null segment and channel", () => {
    expect(validateMatrixEntry({ ...base, segment: null, channel: null })).toBeNull();
  });

  it("rejects an entry where trigger and recommended product match", () => {
    expect(validateMatrixEntry({ ...base, recommendedProductId: base.triggerProductId })).toBe(
      "trigger and recommended product must differ",
    );
  });

  it("rejects a blank triggerProductId", () => {
    expect(validateMatrixEntry({ ...base, triggerProductId: "  " })).toBe("triggerProductId is required");
  });

  it("rejects a blank recommendedProductId", () => {
    expect(validateMatrixEntry({ ...base, recommendedProductId: "" })).toBe(
      "recommendedProductId is required",
    );
  });

  it("rejects a non-string triggerProductId", () => {
    const entry = { ...base, triggerProductId: 7 } as unknown as MatrixEntryInput;
    expect(validateMatrixEntry(entry)).toBe("triggerProductId is required");
  });

  it("rejects a negative priority", () => {
    expect(validateMatrixEntry({ ...base, priority: -1 })).toBe("priority must be a non-negative integer");
  });

  it("rejects a fractional priority", () => {
    expect(validateMatrixEntry({ ...base, priority: 1.5 })).toBe("priority must be a non-negative integer");
  });

  it("rejects a NaN priority", () => {
    expect(validateMatrixEntry({ ...base, priority: NaN })).toBe("priority must be a non-negative integer");
  });

  it("rejects a blank segment", () => {
    expect(validateMatrixEntry({ ...base, segment: "   " })).toBe("segment must not be blank");
  });

  it("rejects an over-long segment", () => {
    expect(validateMatrixEntry({ ...base, segment: "s".repeat(MAX_SCOPE_LENGTH + 1) })).toContain(
      "segment must not exceed",
    );
  });

  it("rejects a blank channel", () => {
    expect(validateMatrixEntry({ ...base, channel: "" })).toBe("channel must not be blank");
  });

  it("rejects an over-long channel", () => {
    expect(validateMatrixEntry({ ...base, channel: "c".repeat(MAX_SCOPE_LENGTH + 1) })).toContain(
      "channel must not exceed",
    );
  });

  it("rejects a non-string segment", () => {
    const entry = { ...base, segment: 42 } as unknown as MatrixEntryInput;
    expect(validateMatrixEntry(entry)).toBe("segment must be a string");
  });
});

// ── matrix/domain: detectDuplicate ────────────────────────────────────────────

describe("detectDuplicate", () => {
  const existing = [
    { id: "m1", triggerProductId: "t1", recommendedProductId: "r1", segment: null, channel: null },
    { id: "m2", triggerProductId: "t1", recommendedProductId: "r1", segment: "SME", channel: "web" },
  ];

  it("finds an exact match on the unscoped rule", () => {
    const hit = detectDuplicate(existing, { triggerProductId: "t1", recommendedProductId: "r1" });
    expect(hit?.id).toBe("m1");
  });

  it("matches segment and channel case-insensitively", () => {
    const hit = detectDuplicate(existing, {
      triggerProductId: "t1",
      recommendedProductId: "r1",
      segment: "sme",
      channel: " WEB ",
    });
    expect(hit?.id).toBe("m2");
  });

  it("returns null when the segment differs", () => {
    const hit = detectDuplicate(existing, {
      triggerProductId: "t1",
      recommendedProductId: "r1",
      segment: "retail",
    });
    expect(hit).toBeNull();
  });

  it("returns null when the channel differs", () => {
    const hit = detectDuplicate(existing, {
      triggerProductId: "t1",
      recommendedProductId: "r1",
      segment: "SME",
      channel: "mobile",
    });
    expect(hit).toBeNull();
  });

  it("returns null when the recommended product differs", () => {
    const hit = detectDuplicate(existing, { triggerProductId: "t1", recommendedProductId: "r2" });
    expect(hit).toBeNull();
  });

  it("returns null when the trigger product differs", () => {
    const hit = detectDuplicate(existing, { triggerProductId: "t2", recommendedProductId: "r1" });
    expect(hit).toBeNull();
  });

  it("returns null for an empty existing set", () => {
    expect(detectDuplicate([], { triggerProductId: "t1", recommendedProductId: "r1" })).toBeNull();
  });

  it("returns the first colliding entry", () => {
    const dupes = [
      { id: "first", triggerProductId: "t", recommendedProductId: "r" },
      { id: "second", triggerProductId: "t", recommendedProductId: "r" },
    ];
    expect(detectDuplicate(dupes, { triggerProductId: "t", recommendedProductId: "r" })?.id).toBe("first");
  });
});

// ── health/domain: computeHealthScore ─────────────────────────────────────────

describe("computeHealthScore", () => {
  it("returns 100 when every factor is perfect", () => {
    expect(
      computeHealthScore({ recency: 100, frequency: 100, monetary: 100, supportTickets: 100, engagement: 100 }),
    ).toBe(100);
  });

  it("returns 0 when every factor is zero", () => {
    expect(
      computeHealthScore({ recency: 0, frequency: 0, monetary: 0, supportTickets: 0, engagement: 0 }),
    ).toBe(0);
  });

  it("returns 0 for an empty factor bundle", () => {
    expect(computeHealthScore({})).toBe(0);
  });

  it("applies the declared weight to each single factor", () => {
    for (const name of HEALTH_FACTOR_NAMES) {
      const score = computeHealthScore({ [name]: 100 } as HealthFactors);
      expect(score).toBe(Math.round(100 * HEALTH_WEIGHTS[name]));
    }
  });

  it("weights sum to 1", () => {
    const total = HEALTH_FACTOR_NAMES.reduce((sum, name) => sum + HEALTH_WEIGHTS[name], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("clamps factors above 100", () => {
    expect(computeHealthScore({ recency: 5_000 })).toBe(Math.round(100 * HEALTH_WEIGHTS.recency));
  });

  it("clamps negative factors to zero", () => {
    expect(computeHealthScore({ recency: -50, engagement: -1 })).toBe(0);
  });

  it("treats NaN factors as zero", () => {
    expect(computeHealthScore({ recency: NaN })).toBe(0);
  });

  it("returns an integer", () => {
    const score = computeHealthScore({ recency: 50, frequency: 33, monetary: 17 });
    expect(Number.isInteger(score)).toBe(true);
  });

  it("stays within 0..100 for extreme input", () => {
    const score = computeHealthScore({
      recency: 1e9,
      frequency: 1e9,
      monetary: 1e9,
      supportTickets: 1e9,
      engagement: 1e9,
    });
    expect(score).toBe(100);
  });

  it("ignores explicitly undefined factors", () => {
    expect(computeHealthScore({ recency: 100, frequency: undefined })).toBe(
      Math.round(100 * HEALTH_WEIGHTS.recency),
    );
  });
});

// ── health/domain: classifyHealth ─────────────────────────────────────────────

describe("classifyHealth", () => {
  it("classifies 0 as critical", () => {
    expect(classifyHealth(0)).toBe("critical");
  });

  it("classifies 39 as critical", () => {
    expect(classifyHealth(39)).toBe("critical");
  });

  it("classifies 40 as at_risk", () => {
    expect(classifyHealth(40)).toBe("at_risk");
  });

  it("classifies 59 as at_risk", () => {
    expect(classifyHealth(59)).toBe("at_risk");
  });

  it("classifies 60 as healthy", () => {
    expect(classifyHealth(60)).toBe("healthy");
  });

  it("classifies 79 as healthy", () => {
    expect(classifyHealth(79)).toBe("healthy");
  });

  it("classifies 80 as excellent", () => {
    expect(classifyHealth(80)).toBe("excellent");
  });

  it("classifies 100 as excellent", () => {
    expect(classifyHealth(100)).toBe("excellent");
  });

  it("clamps above 100 to excellent", () => {
    expect(classifyHealth(250)).toBe("excellent");
  });

  it("clamps below 0 to critical", () => {
    expect(classifyHealth(-25)).toBe("critical");
  });

  it("treats NaN as critical", () => {
    expect(classifyHealth(NaN)).toBe("critical");
  });
});

// ── health/domain: validateFactors ────────────────────────────────────────────

describe("validateFactors", () => {
  it("accepts a single valid factor", () => {
    expect(validateFactors({ recency: 50 })).toBeNull();
  });

  it("accepts all factors at their bounds", () => {
    expect(
      validateFactors({ recency: 0, frequency: 100, monetary: 50, supportTickets: 0, engagement: 100 }),
    ).toBeNull();
  });

  it("rejects an empty bundle", () => {
    expect(validateFactors({})).toBe("at least one factor is required");
  });

  it("rejects a bundle where every factor is undefined", () => {
    expect(validateFactors({ recency: undefined })).toBe("at least one factor is required");
  });

  it("rejects a negative factor", () => {
    expect(validateFactors({ recency: -1 })).toBe("recency must be between 0 and 100");
  });

  it("rejects a factor above 100", () => {
    expect(validateFactors({ engagement: 101 })).toBe("engagement must be between 0 and 100");
  });

  it("rejects a NaN factor", () => {
    expect(validateFactors({ monetary: NaN })).toBe("monetary must be a finite number");
  });

  it("rejects an Infinity factor", () => {
    expect(validateFactors({ monetary: Infinity })).toBe("monetary must be a finite number");
  });

  it("rejects a non-numeric factor", () => {
    expect(validateFactors({ frequency: "high" } as unknown as HealthFactors)).toBe(
      "frequency must be a finite number",
    );
  });

  it("rejects an unknown factor name", () => {
    expect(validateFactors({ churnRisk: 10 } as unknown as HealthFactors)).toBe("unknown factor: churnRisk");
  });

  it("rejects null", () => {
    expect(validateFactors(null as unknown as HealthFactors)).toBe("factors must be an object");
  });

  it("rejects a non-object", () => {
    expect(validateFactors("nope" as unknown as HealthFactors)).toBe("factors must be an object");
  });
});

// ── feedback/domain ───────────────────────────────────────────────────────────

describe("isFeedbackAction", () => {
  it("accepts the known actions", () => {
    for (const action of FEEDBACK_ACTIONS) {
      expect(isFeedbackAction(action)).toBe(true);
    }
  });

  it("rejects an unknown action", () => {
    expect(isFeedbackAction("snoozed")).toBe(false);
  });

  it("rejects an empty action", () => {
    expect(isFeedbackAction("")).toBe(false);
  });
});

describe("validateFeedback", () => {
  it("accepts an acceptance without a reason", () => {
    expect(validateFeedback({ action: "accepted" })).toBeNull();
  });

  it("accepts an acceptance with a reason", () => {
    expect(validateFeedback({ action: "accepted", reason: "customer asked for it" })).toBeNull();
  });

  it("accepts a rejection with a reason", () => {
    expect(validateFeedback({ action: "rejected", reason: "already owns product" })).toBeNull();
  });

  it("rejects a rejection with no reason", () => {
    expect(validateFeedback({ action: "rejected" })).toBe(
      "reason is required when rejecting a recommendation",
    );
  });

  it("rejects a rejection with an empty reason", () => {
    expect(validateFeedback({ action: "rejected", reason: "" })).toContain("reason is required");
  });

  it("rejects a rejection with a whitespace-only reason", () => {
    expect(validateFeedback({ action: "rejected", reason: "    " })).toContain("reason is required");
  });

  it("rejects a rejection with a null reason", () => {
    expect(validateFeedback({ action: "rejected", reason: null })).toContain("reason is required");
  });

  it("rejects an unknown action", () => {
    expect(validateFeedback({ action: "snoozed" })).toBe("unknown feedback action: snoozed");
  });

  it("rejects a non-string action", () => {
    expect(validateFeedback({ action: 5 as unknown as string })).toContain("unknown feedback action");
  });

  it("rejects an over-long reason", () => {
    expect(validateFeedback({ action: "accepted", reason: "x".repeat(MAX_REASON_LENGTH + 1) })).toBe(
      `reason must not exceed ${MAX_REASON_LENGTH} characters`,
    );
  });

  it("accepts a reason exactly at the length limit", () => {
    expect(validateFeedback({ action: "accepted", reason: "x".repeat(MAX_REASON_LENGTH) })).toBeNull();
  });
});

describe("isTerminalAction", () => {
  it("treats accepted as terminal", () => {
    expect(isTerminalAction("accepted")).toBe(true);
  });

  it("treats rejected as terminal", () => {
    expect(isTerminalAction("rejected")).toBe(true);
  });

  it("treats an unknown action as non-terminal", () => {
    expect(isTerminalAction("snoozed")).toBe(false);
  });

  it("treats an empty action as non-terminal", () => {
    expect(isTerminalAction("")).toBe(false);
  });
});

describe("normaliseReason", () => {
  it("maps undefined to null", () => {
    expect(normaliseReason(undefined)).toBeNull();
  });

  it("maps null to null", () => {
    expect(normaliseReason(null)).toBeNull();
  });

  it("maps an empty string to null", () => {
    expect(normaliseReason("")).toBeNull();
  });

  it("maps whitespace to null", () => {
    expect(normaliseReason("   ")).toBeNull();
  });

  it("trims a real reason", () => {
    expect(normaliseReason("  too expensive  ")).toBe("too expensive");
  });
});
