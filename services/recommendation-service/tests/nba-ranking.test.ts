/**
 * F.6 — nba/ranking-domain unit tests. Pure functions, no IO.
 * Focus: deterministic ordering, tie-break stability, empty and all-ineligible
 * candidate sets, and the weighted-score contract.
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_SIGNAL_NAMES,
  DEFAULT_WEIGHTS,
  applyEligibility,
  explainAction,
  normaliseWeights,
  rankActions,
  scoreAction,
  type ActionCandidate,
  type EligibilityContext,
} from "../src/modules/nba/ranking-domain.js";

function candidate(overrides: Partial<ActionCandidate> = {}): ActionCandidate {
  return {
    id: "a",
    actionType: "cross_sell",
    signals: { affinity: 0.5, propensity: 0.5, value: 0.5, urgency: 0.5 },
    ...overrides,
  };
}

// ── weights ───────────────────────────────────────────────────────────────────

describe("normaliseWeights", () => {
  it("default weights sum to 1", () => {
    const total = ACTION_SIGNAL_NAMES.reduce((sum, name) => sum + DEFAULT_WEIGHTS[name], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("returns the defaults when nothing is supplied", () => {
    expect(normaliseWeights(undefined)).toEqual(DEFAULT_WEIGHTS);
  });

  it("normalises raw importances to sum to 1", () => {
    const w = normaliseWeights({ affinity: 3, propensity: 1, value: 1, urgency: 1 });
    const total = ACTION_SIGNAL_NAMES.reduce((sum, name) => sum + w[name], 0);
    expect(total).toBeCloseTo(1, 10);
    expect(w.affinity).toBeCloseTo(0.5, 10);
  });

  it("fills unspecified weights from the defaults", () => {
    const w = normaliseWeights({ affinity: DEFAULT_WEIGHTS.affinity });
    expect(w).toEqual(DEFAULT_WEIGHTS);
  });

  it("falls back to the defaults when every weight is zero", () => {
    expect(normaliseWeights({ affinity: 0, propensity: 0, value: 0, urgency: 0 })).toEqual(
      DEFAULT_WEIGHTS,
    );
  });

  it("treats negative weights as zero", () => {
    const w = normaliseWeights({ affinity: -5, propensity: 1, value: 0, urgency: 0 });
    expect(w.affinity).toBe(0);
    expect(w.propensity).toBe(1);
  });

  it("treats NaN weights as zero", () => {
    const w = normaliseWeights({ affinity: NaN, propensity: 2, value: 0, urgency: 0 });
    expect(w.affinity).toBe(0);
    expect(w.propensity).toBe(1);
  });
});

// ── scoreAction ───────────────────────────────────────────────────────────────

describe("scoreAction", () => {
  it("returns 1 when every signal is at maximum", () => {
    const c = candidate({ signals: { affinity: 1, propensity: 1, value: 1, urgency: 1 } });
    expect(scoreAction(c, DEFAULT_WEIGHTS)).toBe(1);
  });

  it("returns 0 when every signal is at minimum", () => {
    const c = candidate({ signals: { affinity: 0, propensity: 0, value: 0, urgency: 0 } });
    expect(scoreAction(c, DEFAULT_WEIGHTS)).toBe(0);
  });

  it("returns 0 for an empty signal bundle", () => {
    expect(scoreAction(candidate({ signals: {} }), DEFAULT_WEIGHTS)).toBe(0);
  });

  it("weights each signal by its declared weight", () => {
    for (const name of ACTION_SIGNAL_NAMES) {
      const c = candidate({ signals: { [name]: 1 } });
      expect(scoreAction(c, DEFAULT_WEIGHTS)).toBeCloseTo(DEFAULT_WEIGHTS[name], 4);
    }
  });

  it("clamps signals above 1", () => {
    const c = candidate({ signals: { affinity: 99, propensity: 0, value: 0, urgency: 0 } });
    expect(scoreAction(c, DEFAULT_WEIGHTS)).toBeCloseTo(DEFAULT_WEIGHTS.affinity, 4);
  });

  it("clamps negative signals to zero", () => {
    const c = candidate({ signals: { affinity: -1, propensity: -1, value: -1, urgency: -1 } });
    expect(scoreAction(c, DEFAULT_WEIGHTS)).toBe(0);
  });

  it("treats NaN signals as zero", () => {
    const c = candidate({ signals: { affinity: NaN, propensity: NaN, value: NaN, urgency: NaN } });
    expect(scoreAction(c, DEFAULT_WEIGHTS)).toBe(0);
  });

  it("rounds to 4 decimal places", () => {
    const c = candidate({ signals: { affinity: 1 / 3, propensity: 1 / 7, value: 0, urgency: 0 } });
    const score = scoreAction(c, DEFAULT_WEIGHTS);
    expect(score).toBe(Math.round(score * 10_000) / 10_000);
  });

  it("never leaves the 0..1 range", () => {
    const c = candidate({ signals: { affinity: 1e9, propensity: 1e9, value: 1e9, urgency: 1e9 } });
    const score = scoreAction(c, DEFAULT_WEIGHTS);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ── rankActions: ordering + determinism ───────────────────────────────────────

describe("rankActions", () => {
  const spread: ActionCandidate[] = [
    candidate({ id: "low", signals: { affinity: 0.1 } }),
    candidate({ id: "high", signals: { affinity: 1 } }),
    candidate({ id: "mid", signals: { affinity: 0.5 } }),
  ];

  it("sorts by score descending", () => {
    expect(rankActions(spread).map((a) => a.id)).toEqual(["high", "mid", "low"]);
  });

  it("returns an empty array for empty candidates", () => {
    expect(rankActions([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [...spread];
    rankActions(spread);
    expect(spread).toEqual(input);
  });

  it("produces the identical order across repeated calls", () => {
    const first = rankActions(spread).map((a) => a.id);
    for (let i = 0; i < 25; i += 1) {
      expect(rankActions(spread).map((a) => a.id)).toEqual(first);
    }
  });

  it("is independent of the input order", () => {
    const ordered = rankActions(spread).map((a) => a.id);
    const shuffled = rankActions([...spread].reverse()).map((a) => a.id);
    expect(shuffled).toEqual(ordered);
  });

  it("breaks a score tie on priority descending", () => {
    const tied = [
      candidate({ id: "b", priority: 1, signals: { affinity: 0.5 } }),
      candidate({ id: "a", priority: 9, signals: { affinity: 0.5 } }),
    ];
    expect(rankActions(tied).map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("breaks a score+priority tie on id ascending", () => {
    const tied = [
      candidate({ id: "zebra", priority: 5, signals: { affinity: 0.5 } }),
      candidate({ id: "alpha", priority: 5, signals: { affinity: 0.5 } }),
    ];
    expect(rankActions(tied).map((a) => a.id)).toEqual(["alpha", "zebra"]);
  });

  it("id tie-break holds whichever way the input is ordered", () => {
    const a = candidate({ id: "alpha", priority: 5, signals: { affinity: 0.5 } });
    const z = candidate({ id: "zebra", priority: 5, signals: { affinity: 0.5 } });
    expect(rankActions([a, z]).map((c) => c.id)).toEqual(["alpha", "zebra"]);
    expect(rankActions([z, a]).map((c) => c.id)).toEqual(["alpha", "zebra"]);
  });

  it("treats a missing priority as zero in the tie-break", () => {
    const tied = [
      candidate({ id: "b", signals: { affinity: 0.5 } }),
      candidate({ id: "c", priority: 2, signals: { affinity: 0.5 } }),
    ];
    expect(rankActions(tied).map((a) => a.id)).toEqual(["c", "b"]);
  });

  it("treats a non-finite priority as zero", () => {
    const tied = [
      candidate({ id: "b", priority: NaN, signals: { affinity: 0.5 } }),
      candidate({ id: "c", priority: 1, signals: { affinity: 0.5 } }),
    ];
    const ranked = rankActions(tied);
    expect(ranked[0]?.id).toBe("c");
    expect(ranked[1]?.priority).toBe(0);
  });

  it("keeps a full 20-candidate tie in a deterministic id order", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      candidate({ id: `id-${String(i).padStart(2, "0")}`, priority: 3, signals: { affinity: 0.4 } }),
    );
    const forward = rankActions(many).map((a) => a.id);
    const backward = rankActions([...many].reverse()).map((a) => a.id);
    expect(forward).toEqual([...forward].sort());
    expect(backward).toEqual(forward);
  });

  it("normalises productId to null when absent", () => {
    expect(rankActions([candidate({ id: "x" })])[0]?.productId).toBeNull();
  });

  it("passes productId through when present", () => {
    const ranked = rankActions([candidate({ id: "x", productId: "p1" })]);
    expect(ranked[0]?.productId).toBe("p1");
  });

  it("returns a contribution entry per signal", () => {
    const ranked = rankActions([candidate()]);
    expect(ranked[0]?.contributions.map((c) => c.signal)).toEqual([...ACTION_SIGNAL_NAMES]);
  });

  it("honours custom weights", () => {
    const cands = [
      candidate({ id: "affinity-heavy", signals: { affinity: 1, urgency: 0 } }),
      candidate({ id: "urgency-heavy", signals: { affinity: 0, urgency: 1 } }),
    ];
    const urgencyFirst = rankActions(cands, { affinity: 1, propensity: 0, value: 0, urgency: 10 });
    expect(urgencyFirst[0]?.id).toBe("urgency-heavy");
  });

  it("attaches a reason to every ranked action", () => {
    for (const action of rankActions(spread)) {
      expect(action.reason.length).toBeGreaterThan(0);
    }
  });
});

// ── explainAction ─────────────────────────────────────────────────────────────

describe("explainAction", () => {
  it("names the dominant signal", () => {
    const c = candidate({ signals: { affinity: 0, propensity: 1, value: 0, urgency: 0 } });
    const ranked = rankActions([c]);
    expect(ranked[0]?.reason).toContain("propensity");
  });

  it("falls back to priority when no signal contributes", () => {
    const c = candidate({ id: "flat", priority: 7, signals: {} });
    const ranked = rankActions([c]);
    expect(ranked[0]?.reason).toContain("priority 7");
  });

  it("reports priority 0 when the candidate has none", () => {
    const c = candidate({ id: "flat", signals: {} });
    expect(explainAction(c, [])).toContain("priority 0");
  });

  it("is deterministic for a fully tied contribution set", () => {
    const c = candidate({ signals: { affinity: 1, propensity: 1, value: 1, urgency: 1 } });
    const first = rankActions([c])[0]?.reason;
    expect(rankActions([c])[0]?.reason).toBe(first);
  });
});

// ── applyEligibility ──────────────────────────────────────────────────────────

describe("applyEligibility", () => {
  const context: EligibilityContext = {
    channel: "web",
    segment: "sme",
    consentGranted: true,
    healthScore: 60,
  };

  it("keeps a candidate with no eligibility rules", () => {
    expect(applyEligibility([candidate({ id: "free" })], {})).toHaveLength(1);
  });

  it("returns an empty array for empty candidates", () => {
    expect(applyEligibility([], context)).toEqual([]);
  });

  it("drops a suppressed candidate", () => {
    const c = candidate({ id: "off", eligibility: { suppressed: true } });
    expect(applyEligibility([c], context)).toEqual([]);
  });

  it("keeps a candidate explicitly not suppressed", () => {
    const c = candidate({ id: "on", eligibility: { suppressed: false } });
    expect(applyEligibility([c], context)).toHaveLength(1);
  });

  it("drops a consent-required candidate without consent", () => {
    const c = candidate({ id: "consent", eligibility: { requiresConsent: true } });
    expect(applyEligibility([c], { ...context, consentGranted: false })).toEqual([]);
  });

  it("drops a consent-required candidate when consent is unknown", () => {
    const c = candidate({ id: "consent", eligibility: { requiresConsent: true } });
    expect(applyEligibility([c], {})).toEqual([]);
  });

  it("keeps a consent-required candidate with consent", () => {
    const c = candidate({ id: "consent", eligibility: { requiresConsent: true } });
    expect(applyEligibility([c], context)).toHaveLength(1);
  });

  it("filters on channel", () => {
    const c = candidate({ id: "mobile-only", eligibility: { channels: ["mobile"] } });
    expect(applyEligibility([c], context)).toEqual([]);
    expect(applyEligibility([c], { ...context, channel: "mobile" })).toHaveLength(1);
  });

  it("fails closed when a channel rule exists but the context has no channel", () => {
    const c = candidate({ id: "web-only", eligibility: { channels: ["web"] } });
    expect(applyEligibility([c], {})).toEqual([]);
  });

  it("treats an empty channel list as no restriction", () => {
    const c = candidate({ id: "any", eligibility: { channels: [] } });
    expect(applyEligibility([c], {})).toHaveLength(1);
  });

  it("filters on segment", () => {
    const c = candidate({ id: "retail-only", eligibility: { segments: ["retail"] } });
    expect(applyEligibility([c], context)).toEqual([]);
    expect(applyEligibility([c], { ...context, segment: "retail" })).toHaveLength(1);
  });

  it("treats an empty segment list as no restriction", () => {
    const c = candidate({ id: "any", eligibility: { segments: [] } });
    expect(applyEligibility([c], {})).toHaveLength(1);
  });

  it("enforces a minimum health score", () => {
    const c = candidate({ id: "healthy-only", eligibility: { minHealthScore: 70 } });
    expect(applyEligibility([c], context)).toEqual([]);
    expect(applyEligibility([c], { ...context, healthScore: 70 })).toHaveLength(1);
  });

  it("fails closed when a health rule exists but the context has no health score", () => {
    const c = candidate({ id: "healthy-only", eligibility: { minHealthScore: 10 } });
    expect(applyEligibility([c], {})).toEqual([]);
  });

  it("returns an empty array when every candidate is ineligible", () => {
    const all = [
      candidate({ id: "1", eligibility: { suppressed: true } }),
      candidate({ id: "2", eligibility: { requiresConsent: true } }),
      candidate({ id: "3", eligibility: { channels: ["call_centre"] } }),
      candidate({ id: "4", eligibility: { minHealthScore: 100 } }),
    ];
    expect(applyEligibility(all, { channel: "web", healthScore: 10 })).toEqual([]);
  });

  it("ranking an all-ineligible set yields no actions", () => {
    const all = [candidate({ id: "1", eligibility: { suppressed: true } })];
    expect(rankActions(applyEligibility(all, context))).toEqual([]);
  });

  it("preserves the relative order of the survivors", () => {
    const all = [
      candidate({ id: "keep-1" }),
      candidate({ id: "drop", eligibility: { suppressed: true } }),
      candidate({ id: "keep-2" }),
    ];
    expect(applyEligibility(all, context).map((c) => c.id)).toEqual(["keep-1", "keep-2"]);
  });

  it("does not mutate the input array", () => {
    const all = [candidate({ id: "x", eligibility: { suppressed: true } }), candidate({ id: "y" })];
    const before = [...all];
    applyEligibility(all, context);
    expect(all).toEqual(before);
  });
});
