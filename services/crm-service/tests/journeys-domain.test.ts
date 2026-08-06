/**
 * G1 + G2 (spec §25) — journey template domain rules, pure functions only.
 *
 * The rule under test is the one the whole feature exists for: a derived template may
 * adapt step DETAIL (SLA, communication template, mandatory fields, assignment rule) but
 * may NOT rename, drop or reorder the standardised measurement points. Everything here is
 * total — no clock, no database, no HTTP — so each branch is asserted directly rather than
 * inferred from a route's status code.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_DERIVATION_DEPTH,
  OVERRIDABLE_FIELDS,
  VIOLATIONS,
  allowedNextStatuses,
  buildChain,
  canTransitionStatus,
  composeSteps,
  findCanonicalOrderViolations,
  findDroppedRequiredSteps,
  findDuplicateOrdinals,
  findDuplicateStageCodes,
  findUnknownStageCodes,
  indexVocabulary,
  isEditable,
  isStepRequired,
  nextVersionNumber,
  resolveTemplate,
  validateOverride,
  validateTemplateSteps,
  type ResolvableTemplate,
  type VocabularyEntry,
} from "../src/modules/journeys/domain.js";
import type { JourneyStep } from "../src/modules/journeys/schema.js";

/** Mirrors the canonical seed (0082) plus two stage codes a tenant added itself. */
const VOCABULARY: VocabularyEntry[] = [
  { stageCode: "lead_captured", ordinal: 10, required: true, governance: "canonical" },
  { stageCode: "qualified", ordinal: 20, required: true, governance: "canonical" },
  { stageCode: "proposed", ordinal: 30, required: false, governance: "canonical" },
  { stageCode: "agreed", ordinal: 40, required: true, governance: "canonical" },
  { stageCode: "site_survey", ordinal: 25, required: false, governance: "tenant" },
  { stageCode: "panchayat_signoff", ordinal: 35, required: true, governance: "tenant" },
];

function step(stageCode: string, ordinal: number, extra: Partial<JourneyStep> = {}): JourneyStep {
  return { id: `step-${stageCode}`, stageCode, ordinal, ...extra };
}

const NATIONAL_STEPS: JourneyStep[] = [
  step("lead_captured", 10, { slaHours: 24, communicationTemplateRef: "welcome_v1" }),
  step("qualified", 20, { slaHours: 48, mandatoryFields: ["phone"] }),
  step("proposed", 30, { slaHours: 72 }),
  step("agreed", 40, { slaHours: 96, assignmentRule: "round_robin" }),
];

// ── Vocabulary lookups ─────────────────────────────────────────────────────────

describe("indexVocabulary / isStepRequired", () => {
  it("indexes by stage code, last entry winning on a repeat", () => {
    const index = indexVocabulary([
      { stageCode: "qualified", ordinal: 20, required: true, governance: "canonical" },
      { stageCode: "qualified", ordinal: 21, required: false, governance: "tenant" },
    ]);
    expect(index.size).toBe(1);
    expect(index.get("qualified")?.ordinal).toBe(21);
  });

  it("takes the vocabulary's requiredness when the step does not state one", () => {
    expect(isStepRequired(step("qualified", 20), VOCABULARY)).toBe(true);
    expect(isStepRequired(step("proposed", 30), VOCABULARY)).toBe(false);
  });

  it("lets an explicit flag on the step win in both directions", () => {
    expect(isStepRequired(step("proposed", 30, { required: true }), VOCABULARY)).toBe(true);
    // A step may relax its own obligation; what it may NOT do is drop a parent's
    // required step, which findDroppedRequiredSteps decides against the PARENT step.
    expect(isStepRequired(step("qualified", 20, { required: false }), VOCABULARY)).toBe(false);
  });

  it("treats a stage code absent from the vocabulary as not required", () => {
    expect(isStepRequired(step("invented_stage", 5), VOCABULARY)).toBe(false);
    expect(isStepRequired(step("invented_stage", 5), []), "empty vocabulary").toBe(false);
  });
});

// ── Individual rules ───────────────────────────────────────────────────────────

describe("findUnknownStageCodes", () => {
  it("returns nothing when every code resolves", () => {
    expect(findUnknownStageCodes(NATIONAL_STEPS, VOCABULARY)).toEqual([]);
  });

  it("names each unknown code once, in first-seen order", () => {
    const steps = [step("ghost_stage", 1), step("qualified", 20), step("ghost_stage", 2), step("other", 3)];
    expect(findUnknownStageCodes(steps, VOCABULARY)).toEqual(["ghost_stage", "other"]);
  });

  it("reports every code when the vocabulary is empty", () => {
    expect(findUnknownStageCodes([step("qualified", 20)], [])).toEqual(["qualified"]);
  });
});

describe("findDuplicateStageCodes", () => {
  it("returns nothing for a clean list", () => {
    expect(findDuplicateStageCodes(NATIONAL_STEPS)).toEqual([]);
  });

  it("names a repeated stage once even when it appears three times", () => {
    const steps = [step("qualified", 1), step("qualified", 2), step("qualified", 3)];
    expect(findDuplicateStageCodes(steps)).toEqual(["qualified"]);
  });

  it("handles an empty list", () => {
    expect(findDuplicateStageCodes([])).toEqual([]);
  });
});

describe("findDuplicateOrdinals", () => {
  it("returns nothing when every ordinal is distinct", () => {
    expect(findDuplicateOrdinals(NATIONAL_STEPS)).toEqual([]);
  });

  it("names a shared ordinal once — two steps at one position have no defined order", () => {
    const steps = [step("lead_captured", 10), step("qualified", 10), step("proposed", 10)];
    expect(findDuplicateOrdinals(steps)).toEqual([10]);
  });
});

describe("findCanonicalOrderViolations", () => {
  it("accepts canonical stages placed in vocabulary order", () => {
    expect(findCanonicalOrderViolations(NATIONAL_STEPS, VOCABULARY)).toEqual([]);
  });

  it("reports a pair of canonical stages placed against the vocabulary", () => {
    const steps = [step("qualified", 10), step("lead_captured", 20)];
    expect(findCanonicalOrderViolations(steps, VOCABULARY)).toEqual([
      { before: "qualified", after: "lead_captured" },
    ]);
  });

  it("ignores where tenant stages sit — they are not aggregated nationally", () => {
    const steps = [
      step("panchayat_signoff", 5),
      step("lead_captured", 10),
      step("site_survey", 15),
      step("qualified", 20),
    ];
    expect(findCanonicalOrderViolations(steps, VOCABULARY)).toEqual([]);
  });

  it("ignores unknown stage codes here — validateTemplateSteps reports those separately", () => {
    expect(findCanonicalOrderViolations([step("ghost", 1), step("ghost2", 2)], VOCABULARY)).toEqual([]);
  });

  it("cannot violate an order with fewer than two canonical stages", () => {
    expect(findCanonicalOrderViolations([step("agreed", 1)], VOCABULARY)).toEqual([]);
    expect(findCanonicalOrderViolations([], VOCABULARY)).toEqual([]);
  });
});

describe("findDroppedRequiredSteps", () => {
  it("returns nothing when the child keeps every required parent step", () => {
    expect(findDroppedRequiredSteps(NATIONAL_STEPS, NATIONAL_STEPS, VOCABULARY)).toEqual([]);
  });

  it("permits dropping a step the vocabulary does not require", () => {
    const child = NATIONAL_STEPS.filter((s) => s.stageCode !== "proposed");
    expect(findDroppedRequiredSteps(NATIONAL_STEPS, child, VOCABULARY)).toEqual([]);
  });

  it("names every required parent step the child no longer has", () => {
    const child = [step("proposed", 30)];
    expect(findDroppedRequiredSteps(NATIONAL_STEPS, child, VOCABULARY)).toEqual([
      "lead_captured", "qualified", "agreed",
    ]);
  });

  it("honours a parent step that made itself required above the vocabulary", () => {
    const parent = [step("proposed", 30, { required: true })];
    expect(findDroppedRequiredSteps(parent, [step("qualified", 20)], VOCABULARY)).toEqual(["proposed"]);
  });
});

// ── Composite validation ───────────────────────────────────────────────────────

describe("validateTemplateSteps", () => {
  it("passes a well-formed root template", () => {
    expect(validateTemplateSteps(NATIONAL_STEPS, VOCABULARY)).toEqual([]);
  });

  it("reports an unknown stage code with the offending codes in details", () => {
    const violations = validateTemplateSteps([step("not_a_stage", 1)], VOCABULARY);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe(VIOLATIONS.unknownStageCode);
    expect(violations[0]?.details).toEqual({ stageCodes: ["not_a_stage"] });
  });

  it("reports a duplicated stage code", () => {
    const violations = validateTemplateSteps([step("qualified", 1), step("qualified", 2)], VOCABULARY);
    expect(violations.map((v) => v.code)).toEqual([VIOLATIONS.duplicateStageCode]);
  });

  it("reports a duplicated ordinal", () => {
    const violations = validateTemplateSteps(
      [step("lead_captured", 7), step("qualified", 7)],
      VOCABULARY,
    );
    expect(violations.map((v) => v.code)).toEqual([VIOLATIONS.duplicateOrdinal]);
    expect(violations[0]?.details).toEqual({ ordinals: [7] });
  });

  it("reports canonical stages ordered against the vocabulary, naming both stages", () => {
    const violations = validateTemplateSteps(
      [step("agreed", 10), step("lead_captured", 20)],
      VOCABULARY,
    );
    expect(violations.map((v) => v.code)).toEqual([VIOLATIONS.canonicalOrderViolated]);
    expect(violations[0]?.message).toContain("lead_captured");
    expect(violations[0]?.message).toContain("agreed");
  });

  it("reports every independent violation at once rather than the first only", () => {
    const violations = validateTemplateSteps(
      [step("ghost", 1), step("qualified", 5), step("qualified", 5)],
      VOCABULARY,
    );
    expect(violations.map((v) => v.code)).toEqual([
      VIOLATIONS.unknownStageCode,
      VIOLATIONS.duplicateStageCode,
      VIOLATIONS.duplicateOrdinal,
    ]);
  });

  it("accepts an empty step list — the minimum length is a boundary concern (zod)", () => {
    expect(validateTemplateSteps([], VOCABULARY)).toEqual([]);
  });
});

describe("validateOverride", () => {
  it("allows a child to adapt SLA, template ref, mandatory fields and assignment rule", () => {
    const child = [
      step("lead_captured", 10, { slaHours: 4, communicationTemplateRef: "regional_welcome" }),
      step("qualified", 20, { mandatoryFields: ["phone", "gstin"], assignmentRule: "by_territory" }),
      step("proposed", 30),
      step("agreed", 40),
    ];
    expect(validateOverride(NATIONAL_STEPS, child, VOCABULARY)).toEqual([]);
  });

  it("allows a child to add its own tenant stage between canonical ones", () => {
    const child = [...NATIONAL_STEPS, step("site_survey", 25)];
    expect(validateOverride(NATIONAL_STEPS, child, VOCABULARY)).toEqual([]);
  });

  it("refuses a child that drops a required stage", () => {
    const child = NATIONAL_STEPS.filter((s) => s.stageCode !== "agreed");
    const violations = validateOverride(NATIONAL_STEPS, child, VOCABULARY);
    expect(violations.map((v) => v.code)).toEqual([VIOLATIONS.requiredStepDropped]);
    expect(violations[0]?.details).toEqual({ stageCodes: ["agreed"] });
  });

  it("refuses a rename — a renamed stage is an unknown code plus a dropped required step", () => {
    const child = [
      step("lead_captured", 10),
      step("qualified", 20),
      step("proposed", 30),
      step("deal_agreed_locally", 40),
    ];
    const codes = validateOverride(NATIONAL_STEPS, child, VOCABULARY).map((v) => v.code);
    expect(codes).toContain(VIOLATIONS.unknownStageCode);
    expect(codes).toContain(VIOLATIONS.requiredStepDropped);
  });

  it("refuses a child that reorders canonical stages", () => {
    const child = [
      step("qualified", 10),
      step("lead_captured", 20),
      step("proposed", 30),
      step("agreed", 40),
    ];
    expect(validateOverride(NATIONAL_STEPS, child, VOCABULARY).map((v) => v.code))
      .toContain(VIOLATIONS.canonicalOrderViolated);
  });

  /**
   * The contract worth stating plainly: a child's `steps` is its COMPLETE definition, not
   * a patch set. Supplying only the steps it wants to adapt therefore reads as dropping
   * everything else, and every required stage among them is refused. Composition then
   * merges detail over the parent, so restating a step unchanged costs nothing.
   */
  it("treats a child that lists only its adaptations as dropping the rest", () => {
    const patchOnly = [step("lead_captured", 10, { slaHours: 4 })];
    const violations = validateOverride(NATIONAL_STEPS, patchOnly, VOCABULARY);
    expect(violations.map((v) => v.code)).toEqual([VIOLATIONS.requiredStepDropped]);
    expect(violations[0]?.details).toEqual({ stageCodes: ["qualified", "agreed"] });
  });

  it("keeps the child's own step-list rules — a duplicate is still a duplicate", () => {
    const child = [...NATIONAL_STEPS, step("site_survey", 10)];
    expect(validateOverride(NATIONAL_STEPS, child, VOCABULARY).map((v) => v.code))
      .toContain(VIOLATIONS.duplicateOrdinal);
  });
});

// ── Composition ────────────────────────────────────────────────────────────────

describe("composeSteps", () => {
  it("returns the parent unchanged when the child overrides nothing", () => {
    const composed = composeSteps(NATIONAL_STEPS, []);
    expect(composed.steps.map((s) => s.stageCode)).toEqual([
      "lead_captured", "qualified", "proposed", "agreed",
    ]);
    expect(composed.overrides).toEqual({});
  });

  it("records only the fields the child actually changed", () => {
    const composed = composeSteps(NATIONAL_STEPS, [
      // slaHours restated identically — not an override.
      step("lead_captured", 10, { slaHours: 24, communicationTemplateRef: "regional_welcome" }),
      step("qualified", 20, { mandatoryFields: ["phone"] }),
    ]);
    expect(composed.overrides).toEqual({ lead_captured: ["communicationTemplateRef"] });
  });

  it("applies the child's detail and keeps the parent's identity and obligation", () => {
    const parent = [step("qualified", 20, { slaHours: 48, required: true })];
    const composed = composeSteps(parent, [
      { id: "child-step-id", stageCode: "qualified", ordinal: 21, slaHours: 8, required: false },
    ]);
    const merged = composed.steps[0]!;
    expect(merged.id, "identity belongs to whoever defined the step").toBe("step-qualified");
    expect(merged.required, "obligation is not the child's to relax").toBe(true);
    expect(merged.ordinal, "position is the child's to choose").toBe(21);
    expect(merged.slaHours).toBe(8);
    expect(composed.overrides).toEqual({ qualified: ["slaHours"] });
  });

  it("leaves a parent field alone when the child omits it", () => {
    const parent = [step("qualified", 20, { slaHours: 48, assignmentRule: "round_robin" })];
    const composed = composeSteps(parent, [step("qualified", 20, { slaHours: 8 })]);
    expect(composed.steps[0]?.assignmentRule).toBe("round_robin");
  });

  it("appends a child stage the parent does not use, sorted into position by ordinal", () => {
    const composed = composeSteps(NATIONAL_STEPS, [step("site_survey", 25)]);
    expect(composed.steps.map((s) => s.stageCode)).toEqual([
      "lead_captured", "qualified", "site_survey", "proposed", "agreed",
    ]);
  });

  it("sorts the composed list by ordinal so callers never sort to render", () => {
    const parent = [step("agreed", 40), step("lead_captured", 10), step("qualified", 20)];
    expect(composeSteps(parent, []).steps.map((s) => s.ordinal)).toEqual([10, 20, 40]);
  });

  it("detects a changed mandatoryFields array by value, not by reference", () => {
    const parent = [step("qualified", 20, { mandatoryFields: ["phone"] })];
    const same = composeSteps(parent, [step("qualified", 20, { mandatoryFields: ["phone"] })]);
    expect(same.overrides).toEqual({});
    const changed = composeSteps(parent, [step("qualified", 20, { mandatoryFields: ["phone", "gstin"] })]);
    expect(changed.overrides).toEqual({ qualified: ["mandatoryFields"] });
  });

  it("exposes exactly the four adaptable fields", () => {
    expect([...OVERRIDABLE_FIELDS]).toEqual([
      "slaHours", "communicationTemplateRef", "mandatoryFields", "assignmentRule",
    ]);
  });
});

// ── Derivation chain ───────────────────────────────────────────────────────────

function mapOf(...templates: ResolvableTemplate[]): Map<string, ResolvableTemplate> {
  return new Map(templates.map((t) => [t.id, t]));
}

describe("buildChain", () => {
  it("resolves a root template to a single-element chain", () => {
    const root: ResolvableTemplate = { id: "root", parentTemplateId: null, steps: NATIONAL_STEPS };
    const walked = buildChain("root", mapOf(root));
    expect(walked.ok).toBe(true);
    if (walked.ok) expect(walked.chain.map((t) => t.id)).toEqual(["root"]);
  });

  it("returns the chain root-first", () => {
    const root: ResolvableTemplate = { id: "root", parentTemplateId: null, steps: [] };
    const mid: ResolvableTemplate = { id: "mid", parentTemplateId: "root", steps: [] };
    const leaf: ResolvableTemplate = { id: "leaf", parentTemplateId: "mid", steps: [] };
    const walked = buildChain("leaf", mapOf(root, mid, leaf));
    expect(walked.ok).toBe(true);
    if (walked.ok) expect(walked.chain.map((t) => t.id)).toEqual(["root", "mid", "leaf"]);
  });

  it("refuses a dangling parent rather than reporting a half-defined template as fine", () => {
    const leaf: ResolvableTemplate = { id: "leaf", parentTemplateId: "gone", steps: [] };
    const walked = buildChain("leaf", mapOf(leaf));
    expect(walked.ok).toBe(false);
    if (!walked.ok) {
      expect(walked.violations[0]?.code).toBe(VIOLATIONS.parentNotFound);
      expect(walked.violations[0]?.details).toEqual({ templateId: "gone" });
    }
  });

  it("refuses a template that is missing altogether", () => {
    const walked = buildChain("nobody", mapOf());
    expect(walked.ok).toBe(false);
    if (!walked.ok) expect(walked.violations[0]?.code).toBe(VIOLATIONS.parentNotFound);
  });

  it("refuses a template that derives from itself", () => {
    const self: ResolvableTemplate = { id: "self", parentTemplateId: "self", steps: [] };
    const walked = buildChain("self", mapOf(self));
    expect(walked.ok).toBe(false);
    if (!walked.ok) expect(walked.violations[0]?.code).toBe(VIOLATIONS.circularDerivation);
  });

  it("refuses a two-template cycle instead of looping in a request handler", () => {
    const a: ResolvableTemplate = { id: "a", parentTemplateId: "b", steps: [] };
    const b: ResolvableTemplate = { id: "b", parentTemplateId: "a", steps: [] };
    const walked = buildChain("a", mapOf(a, b));
    expect(walked.ok).toBe(false);
    if (!walked.ok) expect(walked.violations[0]?.code).toBe(VIOLATIONS.circularDerivation);
  });

  it("refuses a chain deeper than the configured maximum", () => {
    const depth = MAX_DERIVATION_DEPTH + 2;
    const templates: ResolvableTemplate[] = Array.from({ length: depth }, (_, i) => ({
      id: `t${i}`,
      parentTemplateId: i === 0 ? null : `t${i - 1}`,
      steps: [],
    }));
    const walked = buildChain(`t${depth - 1}`, mapOf(...templates));
    expect(walked.ok).toBe(false);
    if (!walked.ok) {
      expect(walked.violations[0]?.code).toBe(VIOLATIONS.circularDerivation);
      expect(walked.violations[0]?.message).toContain(String(MAX_DERIVATION_DEPTH));
    }
  });

  it("accepts a chain exactly at the maximum depth", () => {
    const templates: ResolvableTemplate[] = Array.from({ length: MAX_DERIVATION_DEPTH }, (_, i) => ({
      id: `d${i}`,
      parentTemplateId: i === 0 ? null : `d${i - 1}`,
      steps: [],
    }));
    const walked = buildChain(`d${MAX_DERIVATION_DEPTH - 1}`, mapOf(...templates));
    expect(walked.ok).toBe(true);
  });
});

describe("resolveTemplate", () => {
  const root: ResolvableTemplate = { id: "root", parentTemplateId: null, steps: NATIONAL_STEPS };

  it("resolves a root template to its own sorted steps", () => {
    const outcome = resolveTemplate("root", mapOf(root), VOCABULARY);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.resolved.chain).toEqual(["root"]);
      expect(outcome.resolved.steps.map((s) => s.ordinal)).toEqual([10, 20, 30, 40]);
      expect(outcome.resolved.overrides).toEqual({});
    }
  });

  it("composes a child's adaptations over the national definition", () => {
    // A child's step list is its whole definition, so every required stage is restated
    // even where it is inherited unchanged — see the "must restate" case below.
    const child: ResolvableTemplate = {
      id: "child",
      parentTemplateId: "root",
      steps: [
        step("lead_captured", 10, { slaHours: 4 }),
        step("qualified", 20),
        step("site_survey", 25),
        step("proposed", 30),
        step("agreed", 40),
      ],
    };
    const outcome = resolveTemplate("child", mapOf(root, child), VOCABULARY);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.resolved.chain).toEqual(["root", "child"]);
      expect(outcome.resolved.steps.map((s) => s.stageCode)).toEqual([
        "lead_captured", "qualified", "site_survey", "proposed", "agreed",
      ]);
      expect(outcome.resolved.steps[0]?.slaHours).toBe(4);
      expect(outcome.resolved.overrides).toEqual({ lead_captured: ["slaHours"] });
    }
  });

  it("reports the root's own violations against the root, not the leaf", () => {
    const brokenRoot: ResolvableTemplate = {
      id: "root", parentTemplateId: null, steps: [step("ghost", 1)],
    };
    const child: ResolvableTemplate = { id: "child", parentTemplateId: "root", steps: [step("qualified", 20)] };
    const outcome = resolveTemplate("child", mapOf(brokenRoot, child), VOCABULARY);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.violations[0]?.code).toBe(VIOLATIONS.unknownStageCode);
  });

  it("refuses a grandchild that drops what the grandparent required", () => {
    // The middle template only adapts an SLA; the grandchild must still not lose `agreed`.
    const mid: ResolvableTemplate = {
      id: "mid",
      parentTemplateId: "root",
      steps: [
        step("lead_captured", 10, { slaHours: 12 }),
        step("qualified", 20),
        step("proposed", 30),
        step("agreed", 40),
      ],
    };
    const leaf: ResolvableTemplate = {
      id: "leaf",
      parentTemplateId: "mid",
      steps: [step("lead_captured", 10), step("qualified", 20), step("proposed", 30)],
    };
    const outcome = resolveTemplate("leaf", mapOf(root, mid, leaf), VOCABULARY);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.violations[0]?.code).toBe(VIOLATIONS.requiredStepDropped);
      expect(outcome.violations[0]?.details).toEqual({ stageCodes: ["agreed"] });
    }
  });

  it("propagates a broken chain rather than composing what it can", () => {
    const orphan: ResolvableTemplate = { id: "orphan", parentTemplateId: "missing", steps: [] };
    const outcome = resolveTemplate("orphan", mapOf(orphan), VOCABULARY);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.violations[0]?.code).toBe(VIOLATIONS.parentNotFound);
  });

  it("reports only the leaf's overrides across a three-deep chain", () => {
    const mid: ResolvableTemplate = {
      id: "mid",
      parentTemplateId: "root",
      steps: [
        step("lead_captured", 10),
        step("qualified", 20, { slaHours: 12 }),
        step("proposed", 30),
        step("agreed", 40),
      ],
    };
    const leaf: ResolvableTemplate = {
      id: "leaf",
      parentTemplateId: "mid",
      steps: [
        step("lead_captured", 10),
        step("qualified", 20),
        step("proposed", 30),
        step("agreed", 40, { assignmentRule: "by_territory" }),
      ],
    };
    const outcome = resolveTemplate("leaf", mapOf(root, mid, leaf), VOCABULARY);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.resolved.chain).toEqual(["root", "mid", "leaf"]);
      expect(outcome.resolved.overrides).toEqual({ agreed: ["assignmentRule"] });
      // The middle link's adaptation still survives into the effective definition.
      expect(outcome.resolved.steps.find((s) => s.stageCode === "qualified")?.slaHours).toBe(12);
    }
  });
});

// ── Publication lifecycle ──────────────────────────────────────────────────────

describe("publication lifecycle", () => {
  it("walks draft → published → deprecated and stops there", () => {
    expect(allowedNextStatuses("draft")).toEqual(["published"]);
    expect(allowedNextStatuses("published")).toEqual(["deprecated"]);
    expect(allowedNextStatuses("deprecated")).toEqual([]);
  });

  it("refuses to skip, repeat or reverse a transition", () => {
    expect(canTransitionStatus("draft", "published")).toBe(true);
    expect(canTransitionStatus("draft", "deprecated")).toBe(false);
    expect(canTransitionStatus("published", "draft")).toBe(false);
    expect(canTransitionStatus("published", "published")).toBe(false);
    expect(canTransitionStatus("deprecated", "published")).toBe(false);
  });

  it("treats an unknown status as having nowhere to go", () => {
    expect(allowedNextStatuses("archived")).toEqual([]);
    expect(canTransitionStatus("archived", "published")).toBe(false);
  });

  it("only a draft is editable — a live definition is amended by a new version", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("published")).toBe(false);
    expect(isEditable("deprecated")).toBe(false);
  });

  it("issues the next version number above the highest already used", () => {
    expect(nextVersionNumber(0)).toBe(1);
    expect(nextVersionNumber(7)).toBe(8);
  });
});
