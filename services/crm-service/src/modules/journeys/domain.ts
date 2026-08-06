/**
 * Journey template domain (G1 + G2, spec §25) — pure functions, no I/O.
 *
 * The rule this module exists to hold: "circles may adapt steps, SLAs and communication
 * templates without code change, but the canonical stage vocabulary and measurement
 * points are standardised nationally so that dashboards aggregate cleanly."
 *
 * Concretely, a derived (child) template may adapt step DETAIL — slaHours,
 * communicationTemplateRef, mandatoryFields, assignmentRule — and may reorder its own
 * additions. It may NOT:
 *   1. introduce a stageCode that is not in the effective stage vocabulary;
 *   2. drop a parent step that is required;
 *   3. order canonical stages so their ordinals contradict the vocabulary ordinals.
 *
 * All three are the difference between "a configurable template" and "a template that has
 * stopped being comparable to its siblings". They are checked here, enforced at the route
 * boundary (422), and — for canonical vocabulary immutability — again by a trigger in
 * migration 0081.
 *
 * Everything below is deliberately total: no throwing, no clock, no database. Callers get
 * a list of violations and decide the HTTP shape.
 */
import type { Governance, JourneyStep } from "./schema.js";

/** The subset of a stage vocabulary row the rules actually depend on. */
export interface VocabularyEntry {
  stageCode: string;
  ordinal: number;
  required: boolean;
  governance: Governance;
}

/** A template as far as resolution is concerned. */
export interface ResolvableTemplate {
  id: string;
  parentTemplateId: string | null;
  steps: JourneyStep[];
}

export interface RuleViolation {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Violation codes. Stable strings — they end up in API error envelopes and in tenant
 * runbooks, so renaming one is a breaking change.
 */
export const VIOLATIONS = {
  unknownStageCode: "UNKNOWN_STAGE_CODE",
  duplicateStageCode: "DUPLICATE_STAGE_CODE",
  duplicateOrdinal: "DUPLICATE_ORDINAL",
  requiredStepDropped: "REQUIRED_STEP_DROPPED",
  canonicalOrderViolated: "CANONICAL_ORDER_VIOLATED",
  parentNotFound: "PARENT_TEMPLATE_NOT_FOUND",
  circularDerivation: "CIRCULAR_DERIVATION",
} as const;

/** Fields a derived template is permitted to change on an inherited step. */
export const OVERRIDABLE_FIELDS = [
  "slaHours",
  "communicationTemplateRef",
  "mandatoryFields",
  "assignmentRule",
] as const;
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

/** Guard against a derivation chain long enough to be a configuration mistake. */
export const MAX_DERIVATION_DEPTH = 10;

function violation(code: string, message: string, details?: Record<string, unknown>): RuleViolation {
  return details === undefined ? { code, message } : { code, message, details };
}

export function indexVocabulary(vocabulary: VocabularyEntry[]): Map<string, VocabularyEntry> {
  const byCode = new Map<string, VocabularyEntry>();
  for (const entry of vocabulary) byCode.set(entry.stageCode, entry);
  return byCode;
}

/**
 * Whether a step must survive derivation. An explicit `required` on the step wins;
 * otherwise the vocabulary's own `required` applies, which is what makes the national
 * measurement points mean something without every template having to restate them.
 */
export function isStepRequired(step: JourneyStep, vocabulary: VocabularyEntry[]): boolean {
  if (step.required !== undefined) return step.required;
  return indexVocabulary(vocabulary).get(step.stageCode)?.required ?? false;
}

/** Stage codes used by the steps but absent from the effective vocabulary. */
export function findUnknownStageCodes(steps: JourneyStep[], vocabulary: VocabularyEntry[]): string[] {
  const known = indexVocabulary(vocabulary);
  const unknown: string[] = [];
  for (const step of steps) {
    if (!known.has(step.stageCode) && !unknown.includes(step.stageCode)) unknown.push(step.stageCode);
  }
  return unknown;
}

/** A stage may appear at most once in a template — a funnel cannot count a stage twice. */
export function findDuplicateStageCodes(steps: JourneyStep[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const step of steps) {
    if (seen.has(step.stageCode) && !duplicates.includes(step.stageCode)) duplicates.push(step.stageCode);
    seen.add(step.stageCode);
  }
  return duplicates;
}

/** Two steps sharing an ordinal have no defined order, so the journey has no defined order. */
export function findDuplicateOrdinals(steps: JourneyStep[]): number[] {
  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const step of steps) {
    if (seen.has(step.ordinal) && !duplicates.includes(step.ordinal)) duplicates.push(step.ordinal);
    seen.add(step.ordinal);
  }
  return duplicates;
}

/**
 * Canonical stages, in the order this template puts them, must agree with the order the
 * vocabulary puts them in. Tenant-defined stages are free to sit anywhere — they are not
 * aggregated nationally, so their position carries no cross-tenant meaning.
 */
export function findCanonicalOrderViolations(
  steps: JourneyStep[],
  vocabulary: VocabularyEntry[],
): Array<{ before: string; after: string }> {
  const byCode = indexVocabulary(vocabulary);
  const canonical = steps
    .filter((s) => byCode.get(s.stageCode)?.governance === "canonical")
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal);

  const conflicts: Array<{ before: string; after: string }> = [];
  for (let i = 1; i < canonical.length; i += 1) {
    const previous = canonical[i - 1]!;
    const current = canonical[i]!;
    const previousOrdinal = byCode.get(previous.stageCode)!.ordinal;
    const currentOrdinal = byCode.get(current.stageCode)!.ordinal;
    if (currentOrdinal < previousOrdinal) {
      conflicts.push({ before: previous.stageCode, after: current.stageCode });
    }
  }
  return conflicts;
}

/** Required parent steps the child no longer has. */
export function findDroppedRequiredSteps(
  parentSteps: JourneyStep[],
  childSteps: JourneyStep[],
  vocabulary: VocabularyEntry[],
): string[] {
  const childCodes = new Set(childSteps.map((s) => s.stageCode));
  return parentSteps
    .filter((s) => isStepRequired(s, vocabulary) && !childCodes.has(s.stageCode))
    .map((s) => s.stageCode);
}

/**
 * Rules that apply to ANY template's own step list, derived or not. A root template is
 * validated with this alone; a child template is validated with this plus
 * {@link validateOverride}.
 */
export function validateTemplateSteps(steps: JourneyStep[], vocabulary: VocabularyEntry[]): RuleViolation[] {
  const violations: RuleViolation[] = [];

  const unknown = findUnknownStageCodes(steps, vocabulary);
  if (unknown.length > 0) {
    violations.push(violation(
      VIOLATIONS.unknownStageCode,
      `stage code(s) not in the stage vocabulary: ${unknown.join(", ")}`,
      { stageCodes: unknown },
    ));
  }

  const duplicateCodes = findDuplicateStageCodes(steps);
  if (duplicateCodes.length > 0) {
    violations.push(violation(
      VIOLATIONS.duplicateStageCode,
      `stage code(s) used more than once: ${duplicateCodes.join(", ")}`,
      { stageCodes: duplicateCodes },
    ));
  }

  const duplicateOrdinals = findDuplicateOrdinals(steps);
  if (duplicateOrdinals.length > 0) {
    violations.push(violation(
      VIOLATIONS.duplicateOrdinal,
      `ordinal(s) used more than once: ${duplicateOrdinals.join(", ")}`,
      { ordinals: duplicateOrdinals },
    ));
  }

  const order = findCanonicalOrderViolations(steps, vocabulary);
  if (order.length > 0) {
    violations.push(violation(
      VIOLATIONS.canonicalOrderViolated,
      order
        .map((c) => `'${c.after}' is placed after '${c.before}' but the vocabulary orders it before`)
        .join("; "),
      { conflicts: order },
    ));
  }

  return violations;
}

/**
 * The override rules. `parentSteps` should be the parent's RESOLVED steps (i.e. after the
 * parent's own inheritance has been applied), so a grandchild cannot drop a step that its
 * grandparent required and its parent merely inherited.
 */
export function validateOverride(
  parentSteps: JourneyStep[],
  childSteps: JourneyStep[],
  vocabulary: VocabularyEntry[],
): RuleViolation[] {
  const violations = validateTemplateSteps(childSteps, vocabulary);

  const dropped = findDroppedRequiredSteps(parentSteps, childSteps, vocabulary);
  if (dropped.length > 0) {
    violations.push(violation(
      VIOLATIONS.requiredStepDropped,
      `required parent step(s) may not be dropped: ${dropped.join(", ")}`,
      { stageCodes: dropped },
    ));
  }

  return violations;
}

/** Which overridable fields the child actually changed, per stage code. */
export type OverrideMap = Record<string, OverridableField[]>;

export interface ComposedSteps {
  steps: JourneyStep[];
  overrides: OverrideMap;
}

function overriddenFields(parent: JourneyStep, child: JourneyStep): OverridableField[] {
  return OVERRIDABLE_FIELDS.filter((field) => {
    const next = child[field];
    if (next === undefined) return false;
    return JSON.stringify(next) !== JSON.stringify(parent[field]);
  });
}

/**
 * Compose a parent's steps with a child's overrides into one effective step list.
 *
 * Merge key is `stageCode`, not step id: the stage code is the standardised thing, and a
 * child authored independently will not know the parent's step ids. The composed step
 * keeps the PARENT's step id and `required` flag — identity and obligation belong to
 * whoever defined the step — and takes ordinal plus any supplied detail from the child.
 * A child step with a stage code the parent does not use is appended as a new step.
 *
 * Steps come back sorted by ordinal, so the caller never has to sort to render a journey.
 */
export function composeSteps(parentSteps: JourneyStep[], childSteps: JourneyStep[]): ComposedSteps {
  const childByCode = new Map(childSteps.map((s) => [s.stageCode, s]));
  const parentCodes = new Set(parentSteps.map((s) => s.stageCode));
  const overrides: OverrideMap = {};
  const composed: JourneyStep[] = [];

  for (const parent of parentSteps) {
    const child = childByCode.get(parent.stageCode);
    if (!child) {
      composed.push({ ...parent });
      continue;
    }
    const changed = overriddenFields(parent, child);
    if (changed.length > 0) overrides[parent.stageCode] = changed;
    const merged: JourneyStep = {
      ...parent,
      ordinal: child.ordinal,
    };
    for (const field of OVERRIDABLE_FIELDS) {
      if (child[field] !== undefined) {
        // Narrowing per-field keeps this assignment typed without a cast.
        if (field === "slaHours") merged.slaHours = child.slaHours;
        if (field === "communicationTemplateRef") merged.communicationTemplateRef = child.communicationTemplateRef;
        if (field === "mandatoryFields") merged.mandatoryFields = child.mandatoryFields;
        if (field === "assignmentRule") merged.assignmentRule = child.assignmentRule;
      }
    }
    composed.push(merged);
  }

  for (const child of childSteps) {
    if (!parentCodes.has(child.stageCode)) composed.push({ ...child });
  }

  composed.sort((a, b) => a.ordinal - b.ordinal);
  return { steps: composed, overrides };
}

export interface ResolvedTemplate {
  /** Template ids from root to leaf. A root-only template resolves to a single id. */
  chain: string[];
  steps: JourneyStep[];
  /** Overridable fields changed by the leaf, per stage code. */
  overrides: OverrideMap;
}

export type ResolutionResult =
  | { ok: true; resolved: ResolvedTemplate }
  | { ok: false; violations: RuleViolation[] };

/**
 * Walk `parentTemplateId` from the given template up to its root, refusing a dangling
 * parent (the configuration is broken and the caller cannot be told a template is fine
 * when half its definition is missing) and refusing a cycle (which would otherwise be an
 * infinite loop in a request handler).
 *
 * Returns the chain root-first.
 */
export function buildChain(
  templateId: string,
  byId: ReadonlyMap<string, ResolvableTemplate>,
): { ok: true; chain: ResolvableTemplate[] } | { ok: false; violations: RuleViolation[] } {
  const chain: ResolvableTemplate[] = [];
  const seen = new Set<string>();
  let currentId: string | null = templateId;

  while (currentId !== null) {
    if (seen.has(currentId)) {
      return {
        ok: false,
        violations: [violation(
          VIOLATIONS.circularDerivation,
          `template ${currentId} derives from itself`,
          { templateId: currentId },
        )],
      };
    }
    seen.add(currentId);

    const current: ResolvableTemplate | undefined = byId.get(currentId);
    if (!current) {
      return {
        ok: false,
        violations: [violation(
          VIOLATIONS.parentNotFound,
          `template ${currentId} was not found`,
          { templateId: currentId },
        )],
      };
    }
    chain.unshift(current);
    if (chain.length > MAX_DERIVATION_DEPTH) {
      return {
        ok: false,
        violations: [violation(
          VIOLATIONS.circularDerivation,
          `derivation chain exceeds the maximum depth of ${MAX_DERIVATION_DEPTH}`,
          { templateId },
        )],
      };
    }
    currentId = current.parentTemplateId;
  }

  return { ok: true, chain };
}

/**
 * Compose a whole derivation chain into one effective template, validating each link.
 *
 * Root steps are validated on their own; every descendant is validated against its
 * parent's already-resolved steps, so a violation is reported against the link that
 * introduced it rather than against the leaf.
 */
export function resolveTemplate(
  templateId: string,
  byId: ReadonlyMap<string, ResolvableTemplate>,
  vocabulary: VocabularyEntry[],
): ResolutionResult {
  const walked = buildChain(templateId, byId);
  if (!walked.ok) return walked;

  const chain = walked.chain;
  const root = chain[0]!;
  const rootViolations = validateTemplateSteps(root.steps, vocabulary);
  if (rootViolations.length > 0) return { ok: false, violations: rootViolations };

  let steps: JourneyStep[] = root.steps.slice().sort((a, b) => a.ordinal - b.ordinal);
  let overrides: OverrideMap = {};

  for (let i = 1; i < chain.length; i += 1) {
    const child = chain[i]!;
    const violations = validateOverride(steps, child.steps, vocabulary);
    if (violations.length > 0) return { ok: false, violations };
    const composed = composeSteps(steps, child.steps);
    steps = composed.steps;
    overrides = composed.overrides;
  }

  return {
    ok: true,
    resolved: { chain: chain.map((t) => t.id), steps, overrides },
  };
}

// ── Publication lifecycle ──────────────────────────────────────────────────────

/** draft → published → deprecated. Nothing comes back from deprecated. */
const STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ["published"],
  published: ["deprecated"],
  deprecated: [],
};

export function allowedNextStatuses(status: string): readonly string[] {
  return STATUS_TRANSITIONS[status] ?? [];
}

export function canTransitionStatus(from: string, to: string): boolean {
  return allowedNextStatuses(from).includes(to);
}

/**
 * A published or deprecated definition is history. Editing it in place would rewrite what
 * every journey instance already recorded, so amendment means a new version row.
 */
export function isEditable(status: string): boolean {
  return status === "draft";
}

/** The version number a new row supersedes `currentMax` with. */
export function nextVersionNumber(currentMax: number): number {
  return currentMax + 1;
}
