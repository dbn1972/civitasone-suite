/**
 * G13 Resolution Playbooks — domain unit tests.
 *
 * These are the tests that matter most for this feature: resolution has to be
 * deterministic, otherwise two identical tickets get different playbooks and the
 * behaviour is neither testable nor auditable.
 */
import { describe, it, expect } from "vitest";
import {
  PLAYBOOK_STATUSES,
  PLAYBOOK_STEP_TYPES,
  canCompleteRun,
  canCompleteStep,
  canDeprecate,
  canEdit,
  canPublish,
  comparePrecedence,
  computeProgressPct,
  criteriaMatches,
  initialRunSteps,
  isStepOverdue,
  nextStep,
  normaliseSteps,
  outstandingMandatorySteps,
  rankCandidates,
  resolvePlaybook,
  specificity,
  stepDueAt,
  validateSteps,
  type MatchCriteria,
  type PlaybookCandidate,
  type PlaybookStep,
  type RunStepState,
} from "../src/modules/playbooks/domain.js";
import { stepTypeSchema } from "../src/modules/playbooks/validators.js";

const T0 = new Date("2026-03-01T09:00:00.000Z");
const CAT_SPEED_POST = "11111111-0000-4000-8000-000000000001";
const CAT_SCSS = "11111111-0000-4000-8000-000000000002";

function candidate(over: Partial<PlaybookCandidate> = {}): PlaybookCandidate {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    playbookKey: "generic",
    versionNumber: 1,
    status: "published",
    publishedAt: T0,
    categoryId: null,
    productCode: null,
    ticketType: null,
    priority: null,
    ...over,
  };
}

function ticket(over: Partial<MatchCriteria> = {}): MatchCriteria {
  return { categoryId: null, productCode: null, ticketType: null, priority: null, ...over };
}

function step(over: Partial<PlaybookStep> = {}): PlaybookStep {
  return {
    id: "s1",
    ordinal: 1,
    type: "instruction",
    title: "Do the thing",
    body: "Detail",
    mandatory: false,
    slaOffsetMinutes: null,
    knowledgeArticleId: null,
    ...over,
  };
}

function runStep(over: Partial<RunStepState> = {}): RunStepState {
  return { stepId: "s1", ordinal: 1, mandatory: false, completedAt: null, completedBy: null, ...over };
}

// ── constants ───────────────────────────────────────────────────────────────

describe("G13 domain — constants", () => {
  it("exposes the three lifecycle statuses", () => {
    expect(PLAYBOOK_STATUSES).toEqual(["draft", "published", "deprecated"]);
  });

  it("keeps the zod step-type enum in step with the domain list", () => {
    expect([...stepTypeSchema.options].sort()).toEqual([...PLAYBOOK_STEP_TYPES].sort());
  });
});

// ── specificity ─────────────────────────────────────────────────────────────

describe("G13 domain — specificity", () => {
  it("counts zero for an unconstrained catch-all", () => {
    expect(specificity(ticket())).toBe(0);
  });

  it("counts each constrained dimension", () => {
    expect(specificity(ticket({ priority: "High" }))).toBe(1);
    expect(specificity(ticket({ priority: "High", productCode: "SPEED_POST" }))).toBe(2);
    expect(specificity(ticket({ priority: "High", productCode: "SPEED_POST", ticketType: "incident" }))).toBe(3);
    expect(
      specificity({
        categoryId: CAT_SPEED_POST,
        productCode: "SPEED_POST",
        ticketType: "incident",
        priority: "High",
      }),
    ).toBe(4);
  });

  it("treats an empty string as unconstrained, not as a value to match", () => {
    expect(specificity(ticket({ productCode: "" }))).toBe(0);
  });
});

// ── criteriaMatches ─────────────────────────────────────────────────────────

describe("G13 domain — criteriaMatches", () => {
  it("a fully unconstrained playbook matches any ticket", () => {
    expect(criteriaMatches(ticket(), ticket())).toBe(true);
    expect(criteriaMatches(ticket(), ticket({ priority: "Low", productCode: "PLI" }))).toBe(true);
  });

  it("matches when every constrained dimension is equal", () => {
    const pb = ticket({ productCode: "SCSS", ticketType: "incident" });
    expect(criteriaMatches(pb, ticket({ productCode: "SCSS", ticketType: "incident", priority: "High" }))).toBe(true);
  });

  it("does not match when a constrained dimension differs", () => {
    const pb = ticket({ productCode: "SCSS" });
    expect(criteriaMatches(pb, ticket({ productCode: "PLI" }))).toBe(false);
  });

  it("does not match when the ticket has no value for a constrained dimension", () => {
    expect(criteriaMatches(ticket({ productCode: "SCSS" }), ticket())).toBe(false);
    expect(criteriaMatches(ticket({ productCode: "SCSS" }), ticket({ productCode: "" }))).toBe(false);
  });

  it("compares case-insensitively so 'HIGH' and 'High' are the same priority", () => {
    expect(criteriaMatches(ticket({ priority: "high" }), ticket({ priority: "HIGH" }))).toBe(true);
    expect(criteriaMatches(ticket({ categoryId: CAT_SCSS.toUpperCase() }), ticket({ categoryId: CAT_SCSS }))).toBe(
      true,
    );
  });
});

// ── resolvePlaybook ─────────────────────────────────────────────────────────

describe("G13 domain — resolvePlaybook", () => {
  it("returns null when there are no candidates at all", () => {
    expect(resolvePlaybook([], ticket({ productCode: "SCSS" }))).toBeNull();
  });

  it("returns null when no candidate matches", () => {
    const pbs = [candidate({ id: "a", playbookKey: "scss", productCode: "SCSS" })];
    expect(resolvePlaybook(pbs, ticket({ productCode: "PLI" }))).toBeNull();
  });

  it("returns the only match", () => {
    const pbs = [candidate({ id: "a", playbookKey: "scss", productCode: "SCSS" })];
    expect(resolvePlaybook(pbs, ticket({ productCode: "SCSS" }))?.id).toBe("a");
  });

  it("most specific wins over a catch-all", () => {
    const pbs = [
      candidate({ id: "catch-all", playbookKey: "generic" }),
      candidate({ id: "product", playbookKey: "scss", productCode: "SCSS" }),
      candidate({
        id: "product-priority",
        playbookKey: "scss-urgent",
        productCode: "SCSS",
        priority: "High",
      }),
    ];
    const got = resolvePlaybook(pbs, ticket({ productCode: "SCSS", priority: "High" }));
    expect(got?.id).toBe("product-priority");
  });

  it("falls back to a less specific playbook when the specific one does not match", () => {
    const pbs = [
      candidate({ id: "catch-all", playbookKey: "generic" }),
      candidate({ id: "speed", playbookKey: "speed-post", productCode: "SPEED_POST" }),
    ];
    expect(resolvePlaybook(pbs, ticket({ productCode: "PLI" }))?.id).toBe("catch-all");
  });

  it("excludes DRAFT playbooks even when they are the most specific match", () => {
    const pbs = [
      candidate({ id: "published-generic", playbookKey: "generic" }),
      candidate({ id: "draft-specific", playbookKey: "scss", productCode: "SCSS", status: "draft" }),
    ];
    expect(resolvePlaybook(pbs, ticket({ productCode: "SCSS" }))?.id).toBe("published-generic");
  });

  it("excludes DEPRECATED playbooks even when they are the most specific match", () => {
    const pbs = [
      candidate({ id: "published-generic", playbookKey: "generic" }),
      candidate({ id: "dep-specific", playbookKey: "scss", productCode: "SCSS", status: "deprecated" }),
    ];
    expect(resolvePlaybook(pbs, ticket({ productCode: "SCSS" }))?.id).toBe("published-generic");
  });

  it("returns null when the only match is a draft", () => {
    const pbs = [candidate({ id: "d", playbookKey: "scss", productCode: "SCSS", status: "draft" })];
    expect(resolvePlaybook(pbs, ticket({ productCode: "SCSS" }))).toBeNull();
  });

  it("breaks an equal-specificity tie by most recently published", () => {
    const pbs = [
      candidate({
        id: "older",
        playbookKey: "aaa-older",
        productCode: "SCSS",
        publishedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      candidate({
        id: "newer",
        playbookKey: "zzz-newer",
        productCode: "SCSS",
        publishedAt: new Date("2026-02-01T00:00:00Z"),
      }),
    ];
    // zzz sorts after aaa alphabetically, so only the publishedAt rule can win here.
    expect(resolvePlaybook(pbs, ticket({ productCode: "SCSS" }))?.id).toBe("newer");
  });

  it("breaks an EXACT tie (same specificity, same publishedAt) by playbookKey ascending", () => {
    const pbs = [
      candidate({ id: "z", playbookKey: "zebra", productCode: "SCSS", publishedAt: T0 }),
      candidate({ id: "a", playbookKey: "alpha", productCode: "SCSS", publishedAt: T0 }),
      candidate({ id: "m", playbookKey: "mango", productCode: "SCSS", publishedAt: T0 }),
    ];
    expect(resolvePlaybook(pbs, ticket({ productCode: "SCSS" }))?.playbookKey).toBe("alpha");
  });

  it("breaks a same-key tie by the highest versionNumber", () => {
    const pbs = [
      candidate({ id: "v1", playbookKey: "scss", versionNumber: 1, productCode: "SCSS", publishedAt: T0 }),
      candidate({ id: "v3", playbookKey: "scss", versionNumber: 3, productCode: "SCSS", publishedAt: T0 }),
      candidate({ id: "v2", playbookKey: "scss", versionNumber: 2, productCode: "SCSS", publishedAt: T0 }),
    ];
    expect(resolvePlaybook(pbs, ticket({ productCode: "SCSS" }))?.versionNumber).toBe(3);
  });

  it("breaks an otherwise total tie by id ascending, so the comparator is never indifferent", () => {
    const pbs = [
      candidate({ id: "bbb", playbookKey: "scss", versionNumber: 1, productCode: "SCSS", publishedAt: T0 }),
      candidate({ id: "aaa", playbookKey: "scss", versionNumber: 1, productCode: "SCSS", publishedAt: T0 }),
    ];
    expect(resolvePlaybook(pbs, ticket({ productCode: "SCSS" }))?.id).toBe("aaa");
    expect(comparePrecedence(pbs[0]!, pbs[1]!)).toBeGreaterThan(0);
    expect(comparePrecedence(pbs[1]!, pbs[1]!)).toBe(0);
  });

  it("sorts a never-published (null publishedAt) candidate last at equal specificity", () => {
    const pbs = [
      candidate({ id: "nopub", playbookKey: "aaa", productCode: "SCSS", publishedAt: null }),
      candidate({ id: "pub", playbookKey: "zzz", productCode: "SCSS", publishedAt: T0 }),
    ];
    expect(resolvePlaybook(pbs, ticket({ productCode: "SCSS" }))?.id).toBe("pub");
  });

  it("is order-independent: shuffling the candidate list never changes the winner", () => {
    const pbs = [
      candidate({ id: "a", playbookKey: "alpha", productCode: "SCSS", publishedAt: T0 }),
      candidate({ id: "b", playbookKey: "beta", productCode: "SCSS", publishedAt: T0 }),
      candidate({ id: "c", playbookKey: "gamma", productCode: "SCSS", priority: "High", publishedAt: T0 }),
      candidate({ id: "d", playbookKey: "delta", publishedAt: T0 }),
    ];
    const target = ticket({ productCode: "SCSS", priority: "High" });
    const expected = resolvePlaybook(pbs, target)?.id;
    expect(expected).toBe("c");
    for (const perm of [
      [3, 2, 1, 0],
      [1, 0, 3, 2],
      [2, 3, 0, 1],
      [0, 2, 3, 1],
    ]) {
      const shuffled = perm.map((i) => pbs[i]!);
      expect(resolvePlaybook(shuffled, target)?.id).toBe(expected);
    }
  });

  it("ranks all eligible candidates best-first for explainability", () => {
    const pbs = [
      candidate({ id: "generic", playbookKey: "generic", publishedAt: T0 }),
      candidate({ id: "specific", playbookKey: "scss", productCode: "SCSS", publishedAt: T0 }),
      candidate({ id: "other", playbookKey: "pli", productCode: "PLI", publishedAt: T0 }),
    ];
    const ranked = rankCandidates(pbs, ticket({ productCode: "SCSS" }));
    expect(ranked.map((r) => r.id)).toEqual(["specific", "generic"]);
  });
});

// ── step definition validation ──────────────────────────────────────────────

describe("G13 domain — validateSteps", () => {
  it("accepts a well-formed step list", () => {
    expect(validateSteps([step({ id: "a", ordinal: 1 }), step({ id: "b", ordinal: 2 })])).toEqual([]);
  });

  it("rejects an empty step list", () => {
    expect(validateSteps([])).toContain("a playbook needs at least one step");
  });

  it("rejects duplicate step ids", () => {
    const errs = validateSteps([step({ id: "a", ordinal: 1 }), step({ id: "a", ordinal: 2 })]);
    expect(errs.some((e) => e.includes("duplicate step id"))).toBe(true);
  });

  it("rejects duplicate ordinals", () => {
    const errs = validateSteps([step({ id: "a", ordinal: 1 }), step({ id: "b", ordinal: 1 })]);
    expect(errs.some((e) => e.includes("duplicate step ordinal"))).toBe(true);
  });

  it("rejects a non-positive ordinal", () => {
    const errs = validateSteps([step({ id: "a", ordinal: 0 })]);
    expect(errs.some((e) => e.includes("ordinal must be >= 1"))).toBe(true);
  });

  it("requires a knowledge article on a knowledge_link step", () => {
    const errs = validateSteps([step({ id: "k", type: "knowledge_link" })]);
    expect(errs.some((e) => e.includes("needs a knowledgeArticleId"))).toBe(true);
    expect(
      validateSteps([
        step({ id: "k", type: "knowledge_link", knowledgeArticleId: "22222222-0000-4000-8000-000000000001" }),
      ]),
    ).toEqual([]);
  });

  it("rejects a negative SLA offset", () => {
    const errs = validateSteps([step({ id: "a", slaOffsetMinutes: -5 })]);
    expect(errs.some((e) => e.includes("cannot be negative"))).toBe(true);
  });

  it("accepts a zero SLA offset (due immediately)", () => {
    expect(validateSteps([step({ id: "a", slaOffsetMinutes: 0 })])).toEqual([]);
  });
});

describe("G13 domain — normaliseSteps", () => {
  it("sorts by ordinal and renumbers densely from 1", () => {
    const got = normaliseSteps([step({ id: "c", ordinal: 30 }), step({ id: "a", ordinal: 10 }), step({ id: "b", ordinal: 20 })]);
    expect(got.map((s) => [s.id, s.ordinal])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("orders equal ordinals by id so the result is deterministic", () => {
    const got = normaliseSteps([step({ id: "b", ordinal: 1 }), step({ id: "a", ordinal: 1 })]);
    expect(got.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("leaves an already-dense list unchanged", () => {
    const input = [step({ id: "a", ordinal: 1 }), step({ id: "b", ordinal: 2 })];
    expect(normaliseSteps(input)).toEqual(input);
  });
});

// ── lifecycle ───────────────────────────────────────────────────────────────

describe("G13 domain — lifecycle guards", () => {
  it("only a draft is editable", () => {
    expect(canEdit("draft")).toBe(true);
    expect(canEdit("published")).toBe(false);
    expect(canEdit("deprecated")).toBe(false);
  });

  it("only a draft with valid steps can be published", () => {
    const good = [step({ id: "a", ordinal: 1 })];
    expect(canPublish("draft", good)).toBe(true);
    expect(canPublish("draft", [])).toBe(false);
    expect(canPublish("draft", [step({ id: "k", type: "knowledge_link" })])).toBe(false);
    expect(canPublish("published", good)).toBe(false);
    expect(canPublish("deprecated", good)).toBe(false);
  });

  it("only a published playbook can be deprecated", () => {
    expect(canDeprecate("published")).toBe(true);
    expect(canDeprecate("draft")).toBe(false);
    expect(canDeprecate("deprecated")).toBe(false);
  });
});

// ── run progress ────────────────────────────────────────────────────────────

describe("G13 domain — run progress", () => {
  it("a run with no steps is 100% (nothing outstanding)", () => {
    expect(computeProgressPct([])).toBe(100);
  });

  it("is 0 when nothing is done", () => {
    expect(computeProgressPct([runStep({ stepId: "a" }), runStep({ stepId: "b" })])).toBe(0);
  });

  it("is 100 only when every step is complete", () => {
    const done = [runStep({ stepId: "a", completedAt: T0 }), runStep({ stepId: "b", completedAt: T0 })];
    expect(computeProgressPct(done)).toBe(100);
  });

  it("floors partial progress and never reports a misleading 100", () => {
    expect(computeProgressPct([runStep({ stepId: "a", completedAt: T0 }), runStep({ stepId: "b" })])).toBe(50);
    const many: RunStepState[] = Array.from({ length: 200 }, (_, i) =>
      runStep({ stepId: `s${i}`, ordinal: i + 1, completedAt: i < 199 ? T0 : null }),
    );
    expect(computeProgressPct(many)).toBe(99);
  });

  it("floors 1 of 3 to 33", () => {
    const steps = [
      runStep({ stepId: "a", ordinal: 1, completedAt: T0 }),
      runStep({ stepId: "b", ordinal: 2 }),
      runStep({ stepId: "c", ordinal: 3 }),
    ];
    expect(computeProgressPct(steps)).toBe(33);
  });

  it("lists outstanding mandatory steps in ordinal order", () => {
    const steps = [
      runStep({ stepId: "c", ordinal: 3, mandatory: true }),
      runStep({ stepId: "a", ordinal: 1, mandatory: true, completedAt: T0 }),
      runStep({ stepId: "b", ordinal: 2, mandatory: true }),
      runStep({ stepId: "d", ordinal: 4, mandatory: false }),
    ];
    expect(outstandingMandatorySteps(steps).map((s) => s.stepId)).toEqual(["b", "c"]);
  });

  it("blocks completion while a mandatory step is outstanding", () => {
    expect(canCompleteRun([runStep({ stepId: "a", mandatory: true })])).toBe(false);
    expect(canCompleteRun([runStep({ stepId: "a", mandatory: true, completedAt: T0 })])).toBe(true);
  });

  it("allows completion when only optional steps are outstanding", () => {
    const steps = [
      runStep({ stepId: "a", ordinal: 1, mandatory: true, completedAt: T0 }),
      runStep({ stepId: "b", ordinal: 2, mandatory: false }),
    ];
    expect(canCompleteRun(steps)).toBe(true);
    expect(computeProgressPct(steps)).toBe(50);
  });

  it("allows completion of a run with no steps", () => {
    expect(canCompleteRun([])).toBe(true);
  });

  it("returns the lowest-ordinal incomplete step as next, null when finished", () => {
    const steps = [
      runStep({ stepId: "c", ordinal: 3 }),
      runStep({ stepId: "a", ordinal: 1, completedAt: T0 }),
      runStep({ stepId: "b", ordinal: 2 }),
    ];
    expect(nextStep(steps)?.stepId).toBe("b");
    expect(nextStep(steps.map((s) => ({ ...s, completedAt: T0 })))).toBeNull();
    expect(nextStep([])).toBeNull();
  });

  it("only an in-progress run accepts step completion", () => {
    expect(canCompleteStep("in_progress")).toBe(true);
    expect(canCompleteStep("completed")).toBe(false);
    expect(canCompleteStep("abandoned")).toBe(false);
  });
});

// ── step SLA ────────────────────────────────────────────────────────────────

describe("G13 domain — step SLA offsets", () => {
  it("computes a due time from the run start plus the offset", () => {
    expect(stepDueAt(T0, 30)?.toISOString()).toBe("2026-03-01T09:30:00.000Z");
    expect(stepDueAt(T0, 0)?.toISOString()).toBe(T0.toISOString());
  });

  it("an untimed step has no due time", () => {
    expect(stepDueAt(T0, null)).toBeNull();
  });

  it("is overdue only when incomplete and past due", () => {
    const later = new Date("2026-03-01T10:00:00.000Z");
    expect(isStepOverdue(later, T0, 30, null)).toBe(true);
    expect(isStepOverdue(later, T0, 30, later)).toBe(false);
    expect(isStepOverdue(later, T0, null, null)).toBe(false);
    expect(isStepOverdue(new Date("2026-03-01T09:10:00.000Z"), T0, 30, null)).toBe(false);
    // exactly at the deadline is not yet a breach
    expect(isStepOverdue(new Date("2026-03-01T09:30:00.000Z"), T0, 30, null)).toBe(false);
  });
});

describe("G13 domain — initialRunSteps", () => {
  it("snapshots every step as incomplete with dense ordinals", () => {
    const got = initialRunSteps([
      step({ id: "b", ordinal: 20, mandatory: true }),
      step({ id: "a", ordinal: 10 }),
    ]);
    expect(got).toEqual([
      { stepId: "a", ordinal: 1, mandatory: false, completedAt: null, completedBy: null },
      { stepId: "b", ordinal: 2, mandatory: true, completedAt: null, completedBy: null },
    ]);
  });

  it("handles an empty definition", () => {
    expect(initialRunSteps([])).toEqual([]);
  });
});
