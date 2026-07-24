/**
 * SVC-083 — pure eligibility evaluator (no I/O, fully unit-tested).
 *
 * A rule set is an ordered list of rules evaluated against a flat `subject`
 * attribute bag. Each rule tests one attribute with an operator; when the test
 * FAILS the rule's `effect` decides the consequence:
 *   - effect "disqualify" → overall outcome not_eligible
 *   - effect "refer"      → overall outcome refer_manual (unless already not_eligible)
 * A rule that passes contributes a positive reason and no negative effect.
 * With zero failing rules the applicant is eligible.
 *
 * Determinism: outcome precedence is not_eligible > refer_manual > eligible, so
 * evaluation order never changes the outcome (only the reason list order).
 */

export const ELIGIBILITY_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "exists", "missing"] as const;
export type EligibilityOp = typeof ELIGIBILITY_OPS[number];

export const RULE_EFFECTS = ["disqualify", "refer"] as const;
export type RuleEffect = typeof RULE_EFFECTS[number];

export interface EligibilityRule {
  id: string;
  attribute: string;
  op: EligibilityOp;
  /** Comparison operand; ignored for exists/missing. Arrays used by in/nin. */
  value?: unknown;
  effect: RuleEffect;
  /** Human description surfaced in reasons. */
  label?: string | undefined;
}

export type EligibilityOutcome = "eligible" | "not_eligible" | "refer_manual";

export interface RuleReason {
  ruleId: string;
  attribute: string;
  op: EligibilityOp;
  passed: boolean;
  effect: RuleEffect;
  message: string;
}

export interface EvaluationResult {
  outcome: EligibilityOutcome;
  reasons: RuleReason[];
}

export type Subject = Record<string, unknown>;

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Evaluate a single rule's predicate. Returns true when the condition holds. */
export function evaluateRule(rule: EligibilityRule, subject: Subject): boolean {
  const present = Object.prototype.hasOwnProperty.call(subject, rule.attribute) &&
    subject[rule.attribute] !== null && subject[rule.attribute] !== undefined;
  const actual = subject[rule.attribute];

  switch (rule.op) {
    case "exists":
      return present;
    case "missing":
      return !present;
    case "eq":
      return present && actual === rule.value;
    case "neq":
      return actual !== rule.value;
    case "in":
      return Array.isArray(rule.value) && rule.value.includes(actual);
    case "nin":
      return Array.isArray(rule.value) && !rule.value.includes(actual);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(actual);
      const b = toNumber(rule.value);
      if (a === null || b === null) return false;
      if (rule.op === "gt") return a > b;
      if (rule.op === "gte") return a >= b;
      if (rule.op === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

function reasonMessage(rule: EligibilityRule, passed: boolean): string {
  const base = rule.label ?? `${rule.attribute} ${rule.op}${rule.value !== undefined ? ` ${JSON.stringify(rule.value)}` : ""}`;
  return passed ? `Passed: ${base}` : `Failed: ${base}`;
}

/**
 * Evaluate a full rule set against a subject → reasoned outcome.
 * A rule set with no rules yields `eligible` with an empty reason list.
 */
export function evaluateEligibility(rules: EligibilityRule[], subject: Subject): EvaluationResult {
  const reasons: RuleReason[] = [];
  let disqualified = false;
  let refer = false;

  for (const rule of rules) {
    const passed = evaluateRule(rule, subject);
    reasons.push({
      ruleId: rule.id,
      attribute: rule.attribute,
      op: rule.op,
      passed,
      effect: rule.effect,
      message: reasonMessage(rule, passed),
    });
    if (!passed) {
      if (rule.effect === "disqualify") disqualified = true;
      else if (rule.effect === "refer") refer = true;
    }
  }

  const outcome: EligibilityOutcome = disqualified ? "not_eligible" : refer ? "refer_manual" : "eligible";
  return { outcome, reasons };
}

/**
 * Structural validation of a rule array (used before publish). Throws on the
 * first structural problem — a published rule set must be well-formed forever.
 */
export function assertRulesWellFormed(rules: unknown): asserts rules is EligibilityRule[] {
  if (!Array.isArray(rules)) throw new Error("RULES_NOT_ARRAY");
  const seen = new Set<string>();
  for (const r of rules as EligibilityRule[]) {
    if (!r || typeof r !== "object") throw new Error("RULE_NOT_OBJECT");
    if (typeof r.id !== "string" || r.id.length === 0) throw new Error("RULE_MISSING_ID");
    if (seen.has(r.id)) throw new Error(`RULE_DUPLICATE_ID: ${r.id}`);
    seen.add(r.id);
    if (typeof r.attribute !== "string" || r.attribute.length === 0) throw new Error("RULE_MISSING_ATTRIBUTE");
    if (!ELIGIBILITY_OPS.includes(r.op)) throw new Error(`RULE_BAD_OP: ${r.op}`);
    if (!RULE_EFFECTS.includes(r.effect)) throw new Error(`RULE_BAD_EFFECT: ${r.effect}`);
    if ((r.op === "in" || r.op === "nin") && !Array.isArray(r.value)) throw new Error(`RULE_OP_NEEDS_ARRAY: ${r.id}`);
  }
}
