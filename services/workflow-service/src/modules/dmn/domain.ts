/**
 * DMN Decision Table Engine — pure domain logic for evaluating decision tables.
 *
 * Supports hit policies:
 *   - UNIQUE: exactly one rule must match (error if zero or multiple)
 *   - FIRST: first matching rule wins (rules evaluated in definition order)
 *   - COLLECT: all matching rules collected (outputs merged/aggregated)
 *   - RULE_ORDER: all matching rules returned in definition order
 *
 * Rule matching: each rule's input conditions are evaluated against the provided
 * input context. A rule matches only if ALL its input conditions are satisfied.
 * Empty/blank conditions are treated as "any" (always match).
 */

import { evaluateCondition } from "../../shared/condition.js";
import type { DmnInput, DmnOutput, DmnRule, DmnHitPolicy } from "./schema.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DmnTableDef {
  hitPolicy: DmnHitPolicy;
  inputs: DmnInput[];
  outputs: DmnOutput[];
  rules: DmnRule[];
}

export interface DmnEvalResult {
  matched: boolean;
  outputs: Record<string, unknown> | Array<Record<string, unknown>>;
  matchedRules: number[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a DMN decision table against a context object.
 * Pure function — no I/O, no side effects.
 */
export function evaluateDecisionTable(
  table: DmnTableDef,
  context: Record<string, unknown>,
): DmnEvalResult {
  const matchedIndices: number[] = [];

  for (let i = 0; i < table.rules.length; i++) {
    const rule = table.rules[i]!;
    if (ruleMatches(rule, context)) {
      matchedIndices.push(i);
    }
  }

  switch (table.hitPolicy) {
    case "UNIQUE":
      return resolveUnique(table, matchedIndices);
    case "FIRST":
      return resolveFirst(table, matchedIndices);
    case "COLLECT":
      return resolveCollect(table, matchedIndices);
    case "RULE_ORDER":
      return resolveRuleOrder(table, matchedIndices);
  }
}

// ---------------------------------------------------------------------------
// Hit Policy Resolvers
// ---------------------------------------------------------------------------

/**
 * UNIQUE: exactly one rule must match.
 * If zero rules match → error.
 * If more than one rule matches → error.
 */
function resolveUnique(table: DmnTableDef, matchedIndices: number[]): DmnEvalResult {
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
      outputs: buildDefaults(table.outputs),
      matchedRules: [],
      error: "UNIQUE: no rules matched",
    };
  }
  return {
    matched: false,
    outputs: {},
    matchedRules: matchedIndices,
    error: `UNIQUE: ${matchedIndices.length} rules matched, expected exactly 1`,
  };
}

/**
 * FIRST: first matching rule wins (rules evaluated in definition order).
 */
function resolveFirst(table: DmnTableDef, matchedIndices: number[]): DmnEvalResult {
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

/**
 * COLLECT: all matching rules collected, outputs merged (last-writer-wins for overlapping keys).
 */
function resolveCollect(table: DmnTableDef, matchedIndices: number[]): DmnEvalResult {
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

/**
 * RULE_ORDER: all matching rules returned in definition order.
 * Returns an array of output objects preserving evaluation order.
 */
function resolveRuleOrder(table: DmnTableDef, matchedIndices: number[]): DmnEvalResult {
  if (matchedIndices.length === 0) {
    return {
      matched: false,
      outputs: [],
      matchedRules: [],
    };
  }
  const results: Array<Record<string, unknown>> = matchedIndices.map(
    (idx) => ({ ...table.rules[idx]!.outputs }),
  );
  return {
    matched: true,
    outputs: results,
    matchedRules: matchedIndices,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ruleMatches(rule: DmnRule, context: Record<string, unknown>): boolean {
  for (const [inputKey, condition] of Object.entries(rule.inputs)) {
    if (!condition || condition.trim() === "") continue; // empty = any
    const expr = `${inputKey} ${condition}`;
    if (!evaluateCondition(expr, context)) {
      return false;
    }
  }
  return true;
}

function buildDefaults(outputs: DmnOutput[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const out of outputs) {
    if (out.defaultValue !== undefined) {
      defaults[out.key] = out.defaultValue;
    }
  }
  return defaults;
}
