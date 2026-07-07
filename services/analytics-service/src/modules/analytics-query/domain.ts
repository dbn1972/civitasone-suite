/**
 * Analytics Query Domain Logic
 *
 * Implements:
 * - Cross-table joins (fact_events self-join patterns, capped at 1000 rows)
 * - Calculated fields via structured expression language (whitelisted columns only)
 * - Drill-through: aggregated → detail rows (capped at 200 rows, tenant-scoped)
 *
 * Security: No eval(). No arbitrary code. Only whitelisted column keys and
 * arithmetic operators are allowed in expressions. All queries are tenant-scoped.
 */
import { METRICS, DIMENSIONS, FILTERS, type MetricDef, type DimensionDef } from "../registry/registry.js";

// ─── Calculated Fields ───────────────────────────────────────────────────────

/** Allowed operators in calculated field expressions. */
export const CALC_OPERATORS = ["add", "subtract", "multiply", "divide"] as const;
export type CalcOperator = (typeof CALC_OPERATORS)[number];

/** A structured expression node — no string parsing, no eval. */
export interface CalcExpression {
  op: CalcOperator;
  left: CalcExpressionOperand;
  right: CalcExpressionOperand;
}

export type CalcExpressionOperand =
  | { type: "column"; key: string }
  | { type: "literal"; value: number }
  | { type: "expression"; expr: CalcExpression };

/** Maximum calculated fields per query. */
export const MAX_CALCULATED_FIELDS = 10;

/** Maximum expression depth to prevent stack overflow. */
export const MAX_EXPRESSION_DEPTH = 5;

/** Maximum expression length (serialized JSON). */
export const MAX_EXPRESSION_LENGTH = 500;

/**
 * Validate a calculated expression:
 * - All column references must be whitelisted
 * - Only allowed operators
 * - Depth limit
 *
 * Throws if invalid.
 */
export function validateExpression(expr: CalcExpression, depth = 0): void {
  if (depth > MAX_EXPRESSION_DEPTH) {
    throw new CalcFieldError("EXPRESSION_TOO_DEEP", `expression exceeds max depth of ${MAX_EXPRESSION_DEPTH}`);
  }

  if (!CALC_OPERATORS.includes(expr.op)) {
    throw new CalcFieldError("INVALID_OPERATOR", `unknown operator: ${expr.op}`);
  }

  validateOperand(expr.left, depth);
  validateOperand(expr.right, depth);
}

function validateOperand(operand: CalcExpressionOperand, depth: number): void {
  switch (operand.type) {
    case "column": {
      // Must be a whitelisted column key (from METRICS, DIMENSIONS, or FILTERS)
      const isWhitelisted =
        operand.key in METRICS || operand.key in DIMENSIONS || operand.key in FILTERS;
      if (!isWhitelisted) {
        throw new CalcFieldError(
          "UNREGISTERED_IDENTIFIER",
          `column key '${operand.key}' is not whitelisted`,
        );
      }
      break;
    }
    case "literal": {
      if (typeof operand.value !== "number" || !Number.isFinite(operand.value)) {
        throw new CalcFieldError("INVALID_LITERAL", "literal value must be a finite number");
      }
      break;
    }
    case "expression": {
      validateExpression(operand.expr, depth + 1);
      break;
    }
    default:
      throw new CalcFieldError("INVALID_OPERAND", "operand must be column, literal, or expression");
  }
}

/**
 * Evaluate a calculated expression against a single row of data.
 * Row values are looked up by column key from the row object.
 */
export function evaluateExpression(expr: CalcExpression, row: Record<string, unknown>): number {
  const left = evaluateOperand(expr.left, row);
  const right = evaluateOperand(expr.right, row);

  switch (expr.op) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      if (right === 0) return 0; // safe division by zero → 0
      return left / right;
  }
}

function evaluateOperand(operand: CalcExpressionOperand, row: Record<string, unknown>): number {
  switch (operand.type) {
    case "column": {
      const val = row[operand.key];
      if (val == null) return 0;
      const num = typeof val === "number" ? val : Number(val);
      return Number.isFinite(num) ? num : 0;
    }
    case "literal":
      return operand.value;
    case "expression":
      return evaluateExpression(operand.expr, row);
  }
}

export class CalcFieldError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CalcFieldError";
  }
}

// ─── Join Definitions ────────────────────────────────────────────────────────

/** Maximum rows returned from a join query. */
export const JOIN_ROW_CAP = 1000;

/** Allowed join types. */
export const JOIN_TYPES = ["inner", "left"] as const;
export type JoinType = (typeof JOIN_TYPES)[number];

/**
 * A join condition between two whitelisted data sources (dimension columns).
 * Both left and right must reference whitelisted column keys.
 */
export interface JoinCondition {
  leftKey: string;
  rightKey: string;
  type: JoinType;
}

/**
 * Validate that join conditions reference only whitelisted columns.
 */
export function validateJoinCondition(condition: JoinCondition): void {
  const allKeys = { ...DIMENSIONS, ...FILTERS };
  if (!(condition.leftKey in allKeys)) {
    throw new JoinError("UNREGISTERED_LEFT_KEY", `left join key '${condition.leftKey}' is not whitelisted`);
  }
  if (!(condition.rightKey in allKeys)) {
    throw new JoinError("UNREGISTERED_RIGHT_KEY", `right join key '${condition.rightKey}' is not whitelisted`);
  }
  if (!JOIN_TYPES.includes(condition.type)) {
    throw new JoinError("INVALID_JOIN_TYPE", `join type must be one of: ${JOIN_TYPES.join(", ")}`);
  }
}

export class JoinError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "JoinError";
  }
}

// ─── Drill-Through ───────────────────────────────────────────────────────────

/** Maximum detail rows returned in drill-through. */
export const DRILL_THROUGH_ROW_CAP = 200;

/**
 * Validate drill-through parameters.
 * reportId and cellId are opaque identifiers — they map to a stored query run + filter state.
 */
export function validateDrillThroughParams(reportId: string, cellId: string): void {
  if (!reportId || typeof reportId !== "string") {
    throw new DrillThroughError("INVALID_REPORT_ID", "reportId is required");
  }
  if (!cellId || typeof cellId !== "string") {
    throw new DrillThroughError("INVALID_CELL_ID", "cellId is required");
  }
}

export class DrillThroughError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DrillThroughError";
  }
}
