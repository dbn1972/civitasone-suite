import { evaluateCondition } from "../../shared/condition.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DecisionInput {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
}

export interface DecisionOutput {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
  defaultValue?: unknown;
}

export interface DecisionRule {
  inputs: Record<string, string>;
  outputs: Record<string, unknown>;
  priority?: number;
}

export interface DecisionTableDef {
  hitPolicy: "first" | "collect" | "unique";
  inputs: DecisionInput[];
  outputs: DecisionOutput[];
  rules: DecisionRule[];
}

export interface EvalResult {
  matched: boolean;
  outputs: Record<string, unknown>;
  matchedRules: number[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a decision table against a context object. Each rule's inputs are
 * condition expressions (e.g. `> 500000`, `== 'high'`, `in ['a','b']`) that
 * are evaluated by composing them as `{inputKey} {condition}` and running them
 * through the shared condition evaluator.
 */
export function evaluateDecisionTable(
  table: DecisionTableDef,
  context: Record<string, unknown>,
): EvalResult {
  const matchedIndices: number[] = [];

  for (let i = 0; i < table.rules.length; i++) {
    const rule = table.rules[i]!;
    if (ruleMatches(rule, context)) {
      matchedIndices.push(i);
    }
  }

  switch (table.hitPolicy) {
    case "first":
      return resolveFirst(table, matchedIndices);
    case "collect":
      return resolveCollect(table, matchedIndices);
    case "unique":
      return resolveUnique(table, matchedIndices);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ruleMatches(rule: DecisionRule, context: Record<string, unknown>): boolean {
  for (const [inputKey, condition] of Object.entries(rule.inputs)) {
    if (!condition || condition.trim() === "") continue;
    // Compose as "field condition" so the condition evaluator can parse it
    const expr = `${inputKey} ${condition}`;
    if (!evaluateCondition(expr, context)) {
      return false;
    }
  }
  return true;
}

function buildDefaults(outputs: DecisionOutput[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const out of outputs) {
    if (out.defaultValue !== undefined) {
      defaults[out.key] = out.defaultValue;
    }
  }
  return defaults;
}

function resolveFirst(table: DecisionTableDef, matchedIndices: number[]): EvalResult {
  if (matchedIndices.length === 0) {
    return {
      matched: false,
      outputs: buildDefaults(table.outputs),
      matchedRules: [],
    };
  }
  const firstIdx = matchedIndices[0]!;
  return {
    matched: true,
    outputs: { ...table.rules[firstIdx]!.outputs },
    matchedRules: [firstIdx],
  };
}

function resolveCollect(table: DecisionTableDef, matchedIndices: number[]): EvalResult {
  if (matchedIndices.length === 0) {
    return {
      matched: false,
      outputs: buildDefaults(table.outputs),
      matchedRules: [],
    };
  }
  const merged: Record<string, unknown> = {};
  for (const idx of matchedIndices) {
    Object.assign(merged, table.rules[idx]!.outputs);
  }
  return {
    matched: true,
    outputs: merged,
    matchedRules: matchedIndices,
  };
}

function resolveUnique(table: DecisionTableDef, matchedIndices: number[]): EvalResult {
  if (matchedIndices.length === 1) {
    const idx = matchedIndices[0]!;
    return {
      matched: true,
      outputs: { ...table.rules[idx]!.outputs },
      matchedRules: [idx],
    };
  }
  if (matchedIndices.length === 0) {
    return {
      matched: false,
      outputs: {},
      matchedRules: [],
      error: "unique: no rules matched",
    };
  }
  return {
    matched: false,
    outputs: {},
    matchedRules: matchedIndices,
    error: `unique: ${matchedIndices.length} rules matched, expected exactly 1`,
  };
}
