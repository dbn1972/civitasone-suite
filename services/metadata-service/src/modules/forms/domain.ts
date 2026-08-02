/**
 * Forms engine domain logic — FRM-04 (dependent-field cascades) and
 * FRM-05 (show/hide conditions).
 *
 * This module is PURE: no database, no Fastify, no clock. It extends the
 * existing rule engine in `modules/rules/domain.ts` rather than replacing it —
 * a show/hide condition is an ordinary rule expression evaluated by
 * `evaluateExpression`, and required-field checking still goes through
 * `validateFieldValue`. What is added here is the two things the rule engine had
 * no concept of: a dependency graph between fields, and the idea that a field
 * may not be present on the form at all.
 *
 * ── FRM-04: cascade rules ────────────────────────────────────────────────────
 * A cascade rule says "field X's available options are determined by field P's
 * current value" (district ← state). The rules form a directed graph
 * X → dependsOn(P). A cycle in that graph (A ← B, B ← A) can never be resolved:
 * neither field can offer options until the other has a value. That is a defect
 * in the *definition*, so `validateCascadeRules` rejects it at definition time
 * (the route maps this to 422) instead of letting a citizen discover a dead form
 * at render time.
 *
 * ── FRM-05: hidden fields ────────────────────────────────────────────────────
 * DOCUMENTED RULE, enforced by `applyVisibility`:
 *
 *   A hidden field is not part of the submission. Its submitted value is
 *   STRIPPED server-side BEFORE validation, and because it is gone it can
 *   neither fail a required-field check nor be persisted.
 *
 * Both halves of that rule matter and they are the same decision seen from two
 * sides. If hidden fields were validated, a conditional form would be
 * unsubmittable (a required "GST number" hidden because "business type =
 * individual" would block every individual). If hidden values were kept, a
 * client could bypass the condition it was supposed to be gated by — the
 * show/hide condition is a server-side authorisation over which fields exist,
 * so a value for a field that does not exist must be discarded, not trusted.
 * Stripping is reported (`stripped`) rather than silent, so a caller can see
 * that the server disagreed with it.
 */

import { evaluateExpression, validateFieldValue, type FieldDef } from "../rules/domain.js";

/** Cascade rule: `field`'s options depend on `dependsOn`'s current value. */
export interface CascadeRule {
  /** The dependent field whose option list is narrowed. */
  field: string;
  /** The controlling (parent) field. */
  dependsOn: string;
  /** parent value → allowed option list for `field`. */
  options: Record<string, string[]>;
}

/** Visibility rule: `field` is shown only when `showWhen` evaluates truthy. */
export interface VisibilityRule {
  field: string;
  /** A rule-engine expression, e.g. `business_type == "company"`. */
  showWhen: string;
}

export interface CascadeValidationResult {
  valid: boolean;
  errors: string[];
  /** The dependency cycle as a field path, e.g. ["a","b","a"] — set only when one exists. */
  cycle?: string[];
}

// ── FRM-04: definition-time validation ───────────────────────────────────────

/**
 * Depth-first search over field → dependsOn edges, returning the first cycle
 * found as a readable path. Iterative-recursive DFS with an explicit "on the
 * current path" set: a back-edge to a node already on the path is a cycle, a
 * re-visit of a fully-explored node is not.
 */
export function findCascadeCycle(rules: CascadeRule[]): string[] | null {
  const edges = new Map<string, string[]>();
  for (const r of rules) {
    const existing = edges.get(r.field);
    if (existing) existing.push(r.dependsOn);
    else edges.set(r.field, [r.dependsOn]);
  }

  const settled = new Set<string>();
  const onPath = new Set<string>();
  const path: string[] = [];

  function visit(node: string): string[] | null {
    if (onPath.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (settled.has(node)) return null;
    onPath.add(node);
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    onPath.delete(node);
    settled.add(node);
    return null;
  }

  for (const start of edges.keys()) {
    const found = visit(start);
    if (found) return found;
  }
  return null;
}

/**
 * Full definition-time check for a cascade rule set. Rejects: unknown field
 * references, self-dependency, duplicate rules for the same field, empty option
 * maps, and dependency cycles.
 *
 * `knownFields` is the entity's field api-names. Pass an empty array to skip the
 * existence check (used when previewing a rule set with no entity bound yet).
 */
export function validateCascadeRules(rules: CascadeRule[], knownFields: string[] = []): CascadeValidationResult {
  const errors: string[] = [];
  const known = new Set(knownFields);
  const seen = new Set<string>();

  for (const r of rules) {
    if (seen.has(r.field)) errors.push(`duplicate cascade rule for field "${r.field}"`);
    seen.add(r.field);

    if (r.field === r.dependsOn) errors.push(`field "${r.field}" cannot depend on itself`);
    if (known.size > 0 && !known.has(r.field)) errors.push(`cascade rule references unknown field "${r.field}"`);
    if (known.size > 0 && !known.has(r.dependsOn)) errors.push(`cascade rule references unknown parent field "${r.dependsOn}"`);
    if (Object.keys(r.options).length === 0) errors.push(`cascade rule for "${r.field}" has no option mappings`);
  }

  const cycle = findCascadeCycle(rules);
  if (cycle) errors.push(`cascade rules form a cycle: ${cycle.join(" -> ")}`);

  return {
    valid: errors.length === 0,
    errors,
    ...(cycle ? { cycle } : {}),
  };
}

/**
 * Definition-time check for visibility rules: every rule must name a known
 * field, must not be empty, and must not reference the field it controls (a
 * self-referential condition is unresolvable in the same way a cascade cycle is).
 */
export function validateVisibilityRules(rules: VisibilityRule[], knownFields: string[] = []): string[] {
  const errors: string[] = [];
  const known = new Set(knownFields);
  const seen = new Set<string>();

  for (const r of rules) {
    if (seen.has(r.field)) errors.push(`duplicate visibility rule for field "${r.field}"`);
    seen.add(r.field);
    if (known.size > 0 && !known.has(r.field)) errors.push(`visibility rule references unknown field "${r.field}"`);
    if (r.showWhen.trim() === "") errors.push(`visibility rule for "${r.field}" has an empty condition`);
    else if (referencesField(r.showWhen, r.field)) {
      errors.push(`visibility rule for "${r.field}" references its own field`);
    }
  }
  return errors;
}

/** Word-boundary check so `state` does not match `state_code`. */
function referencesField(expression: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zA-Z0-9_])${escaped}([^a-zA-Z0-9_]|$)`).test(expression);
}

// ── FRM-04: server-side resolution ───────────────────────────────────────────

export interface ResolvedCascade {
  field: string;
  dependsOn: string;
  /** The parent's current value, or null when the parent has no value yet. */
  parentValue: string | null;
  /** Options available given `parentValue`. Empty while the parent is unset. */
  options: string[];
}

/**
 * Resolve the option list for every cascaded field given the values entered so
 * far. Resolution is server-side and total: a field whose parent is unset gets
 * an empty option list (the UI disables it) rather than the full union, which
 * would let a client pick a district that does not belong to the chosen state.
 */
export function resolveCascadeOptions(rules: CascadeRule[], values: Record<string, unknown>): ResolvedCascade[] {
  return rules.map((r) => {
    const raw = values[r.dependsOn];
    const parentValue = raw === undefined || raw === null || raw === "" ? null : String(raw);
    const options = parentValue === null ? [] : (r.options[parentValue] ?? []);
    return { field: r.field, dependsOn: r.dependsOn, parentValue, options };
  });
}

/** Cascade values that are not in the resolved option list for their parent. */
export function findCascadeViolations(rules: CascadeRule[], values: Record<string, unknown>): string[] {
  const violations: string[] = [];
  for (const resolved of resolveCascadeOptions(rules, values)) {
    const raw = values[resolved.field];
    if (raw === undefined || raw === null || raw === "") continue;
    if (!resolved.options.includes(String(raw))) {
      violations.push(
        resolved.parentValue === null
          ? `"${resolved.field}" cannot be set until "${resolved.dependsOn}" has a value`
          : `"${resolved.field}" is not a valid option for ${resolved.dependsOn}="${resolved.parentValue}"`,
      );
    }
  }
  return violations;
}

// ── FRM-05: visibility evaluation ────────────────────────────────────────────

export interface VisibilityOutcome {
  visible: string[];
  hidden: string[];
  /** Values accepted for evaluation, with hidden fields removed. */
  values: Record<string, unknown>;
  /** Field names whose submitted values were discarded because the field is hidden. */
  stripped: string[];
}

/**
 * Evaluate every visibility rule against `values` and strip hidden fields.
 *
 * Conditions are evaluated against the values as submitted — a hidden field's
 * value is removed *after* evaluation, never before, so the outcome does not
 * depend on rule ordering. A field with no rule is always visible. An
 * expression that throws is treated as "hidden" (fail closed): a broken
 * condition must not open a field the tenant meant to gate.
 */
export function applyVisibility(
  fields: string[],
  rules: VisibilityRule[],
  values: Record<string, unknown>,
): VisibilityOutcome {
  const byField = new Map<string, VisibilityRule>();
  for (const r of rules) byField.set(r.field, r);

  const visible: string[] = [];
  const hidden: string[] = [];
  for (const field of fields) {
    const rule = byField.get(field);
    if (!rule) {
      visible.push(field);
      continue;
    }
    let shown: boolean;
    try {
      shown = evaluateExpression(rule.showWhen, values);
    } catch {
      shown = false;
    }
    if (shown) visible.push(field);
    else hidden.push(field);
  }

  const kept: Record<string, unknown> = {};
  const stripped: string[] = [];
  const hiddenSet = new Set(hidden);
  for (const [k, v] of Object.entries(values)) {
    if (hiddenSet.has(k)) stripped.push(k);
    else kept[k] = v;
  }

  return { visible, hidden, values: kept, stripped };
}

// ── Combined submission validation ───────────────────────────────────────────

export interface FormValidationResult {
  /** Values that will be persisted: hidden fields removed. */
  values: Record<string, unknown>;
  visible: string[];
  hidden: string[];
  stripped: string[];
  errors: string[];
}

/**
 * Validate a form submission: strip hidden fields, then require/type-check only
 * the fields that survived, then check cascade option membership.
 *
 * The ordering is the whole point. Required-field validation runs on the
 * post-strip value set, so a hidden required field cannot block a submission,
 * and a hidden field's value cannot reach the database.
 */
export function validateFormSubmission(
  fields: FieldDef[],
  visibilityRules: VisibilityRule[],
  cascadeRules: CascadeRule[],
  submitted: Record<string, unknown>,
): FormValidationResult {
  const outcome = applyVisibility(fields.map((f) => f.apiName), visibilityRules, submitted);
  const visibleSet = new Set(outcome.visible);

  const errors: string[] = [];
  for (const field of fields) {
    if (!visibleSet.has(field.apiName)) continue;
    const err = validateFieldValue(outcome.values[field.apiName], field);
    if (err !== null) errors.push(err);
  }

  // Only cascades on still-visible fields are enforced; a hidden cascade target
  // has no value left to check.
  const liveCascades = cascadeRules.filter((r) => visibleSet.has(r.field));
  errors.push(...findCascadeViolations(liveCascades, outcome.values));

  return {
    values: outcome.values,
    visible: outcome.visible,
    hidden: outcome.hidden,
    stripped: outcome.stripped,
    errors,
  };
}
