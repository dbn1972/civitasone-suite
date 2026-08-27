/**
 * Pure domain logic tests — validates calculated fields, joins, drill-through validation,
 * and scheduled export cadence computation without touching the database.
 */
import { describe, it, expect } from "vitest";
import {
  validateExpression,
  evaluateExpression,
  validateJoinCondition,
  validateDrillThroughParams,
  CalcFieldError,
  JoinError,
  DrillThroughError,
  CALC_OPERATORS,
  JOIN_TYPES,
  MAX_EXPRESSION_DEPTH,
  JOIN_ROW_CAP,
  DRILL_THROUGH_ROW_CAP,
  type CalcExpression,
} from "../src/modules/analytics-query/domain.js";
import { computeNextRunAt, isValidCadence } from "../src/modules/exports/scheduled-domain.js";

// ─── Calculated Fields ───────────────────────────────────────────────────────

describe("validateExpression", () => {
  it("validates a simple add expression with whitelisted columns", () => {
    const expr: CalcExpression = {
      op: "add",
      left: { type: "column", key: "amount_sum" },
      right: { type: "literal", value: 10 },
    };
    expect(() => validateExpression(expr)).not.toThrow();
  });

  it("validates nested expressions within depth limit", () => {
    const expr: CalcExpression = {
      op: "multiply",
      left: {
        type: "expression",
        expr: {
          op: "add",
          left: { type: "column", key: "event_count" },
          right: { type: "literal", value: 1 },
        },
      },
      right: { type: "literal", value: 100 },
    };
    expect(() => validateExpression(expr)).not.toThrow();
  });

  it("throws CalcFieldError for unknown column key", () => {
    const expr: CalcExpression = {
      op: "add",
      left: { type: "column", key: "unknown_column" },
      right: { type: "literal", value: 1 },
    };
    expect(() => validateExpression(expr)).toThrow(CalcFieldError);
  });

  // Regression: see the "__proto__" note on validateJoinCondition above —
  // the same class of bug existed here via `key in METRICS || key in
  // DIMENSIONS || key in FILTERS`. isWhitelistedIdentifier() fixes it.
  it("throws CalcFieldError for '__proto__' as a calculated-field column key", () => {
    const expr: CalcExpression = {
      op: "add",
      left: { type: "column", key: "__proto__" },
      right: { type: "literal", value: 1 },
    };
    expect(() => validateExpression(expr)).toThrow(CalcFieldError);
  });

  it("throws CalcFieldError for invalid operator", () => {
    const expr = {
      op: "evil_op" as any,
      left: { type: "literal", value: 1 },
      right: { type: "literal", value: 1 },
    };
    expect(() => validateExpression(expr)).toThrow(CalcFieldError);
  });

  it("throws CalcFieldError for non-finite literal", () => {
    const expr: CalcExpression = {
      op: "add",
      left: { type: "literal", value: Infinity },
      right: { type: "literal", value: 1 },
    };
    expect(() => validateExpression(expr)).toThrow(CalcFieldError);
  });

  it("throws CalcFieldError when expression exceeds max depth", () => {
    // Build a deeply nested expression beyond MAX_EXPRESSION_DEPTH
    let expr: CalcExpression = { op: "add", left: { type: "literal", value: 1 }, right: { type: "literal", value: 1 } };
    for (let i = 0; i < MAX_EXPRESSION_DEPTH + 2; i++) {
      expr = { op: "add", left: { type: "expression", expr }, right: { type: "literal", value: 1 } };
    }
    expect(() => validateExpression(expr)).toThrow(CalcFieldError);
  });

  it("throws CalcFieldError for invalid operand type", () => {
    const expr = {
      op: "add",
      left: { type: "invalid_type" } as any,
      right: { type: "literal", value: 1 },
    };
    expect(() => validateExpression(expr)).toThrow(CalcFieldError);
  });
});

describe("evaluateExpression", () => {
  it("adds two columns", () => {
    const expr: CalcExpression = {
      op: "add",
      left: { type: "column", key: "a" },
      right: { type: "column", key: "b" },
    };
    expect(evaluateExpression(expr, { a: 10, b: 5 })).toBe(15);
  });

  it("subtracts literal from column", () => {
    const expr: CalcExpression = {
      op: "subtract",
      left: { type: "column", key: "total" },
      right: { type: "literal", value: 3 },
    };
    expect(evaluateExpression(expr, { total: 10 })).toBe(7);
  });

  it("multiplies column by literal", () => {
    const expr: CalcExpression = {
      op: "multiply",
      left: { type: "column", key: "count" },
      right: { type: "literal", value: 2 },
    };
    expect(evaluateExpression(expr, { count: 5 })).toBe(10);
  });

  it("divides safely (returns 0 for division by zero)", () => {
    const expr: CalcExpression = {
      op: "divide",
      left: { type: "column", key: "a" },
      right: { type: "literal", value: 0 },
    };
    expect(evaluateExpression(expr, { a: 10 })).toBe(0);
  });

  it("treats null column values as 0", () => {
    const expr: CalcExpression = {
      op: "add",
      left: { type: "column", key: "missing" },
      right: { type: "literal", value: 5 },
    };
    expect(evaluateExpression(expr, {})).toBe(5);
  });

  it("evaluates nested expressions", () => {
    const expr: CalcExpression = {
      op: "add",
      left: {
        type: "expression",
        expr: { op: "multiply", left: { type: "column", key: "x" }, right: { type: "literal", value: 2 } },
      },
      right: { type: "literal", value: 3 },
    };
    expect(evaluateExpression(expr, { x: 4 })).toBe(11); // (4*2) + 3
  });

  it("handles string values by converting to number", () => {
    const expr: CalcExpression = {
      op: "add",
      left: { type: "column", key: "val" },
      right: { type: "literal", value: 1 },
    };
    expect(evaluateExpression(expr, { val: "42" })).toBe(43);
  });

  it("treats NaN column as 0", () => {
    const expr: CalcExpression = {
      op: "add",
      left: { type: "column", key: "bad" },
      right: { type: "literal", value: 1 },
    };
    expect(evaluateExpression(expr, { bad: "not_a_number" })).toBe(1);
  });
});

// ─── Join Validation ─────────────────────────────────────────────────────────

describe("validateJoinCondition", () => {
  it("accepts valid join condition with whitelisted keys", () => {
    expect(() => validateJoinCondition({ leftKey: "source", rightKey: "status", type: "inner" })).not.toThrow();
  });

  it("throws JoinError for unregistered left key", () => {
    expect(() => validateJoinCondition({ leftKey: "unknown", rightKey: "source", type: "inner" })).toThrow(JoinError);
  });

  it("throws JoinError for unregistered right key", () => {
    expect(() => validateJoinCondition({ leftKey: "source", rightKey: "unknown", type: "inner" })).toThrow(JoinError);
  });

  // Regression: validateJoinCondition used to check `key in { ...DIMENSIONS,
  // ...FILTERS }`, and `in` walks the prototype chain — so "__proto__" /
  // "constructor" (own properties of nothing here, but found via inheritance
  // from Object.prototype) incorrectly passed as "whitelisted". Confirmed
  // live: this let an authenticated analytics_user crash POST
  // /v1/analytics/query with a Postgres "syntax error at or near '='" by
  // passing one of these as a join leftKey/rightKey. hasKeyIn() (an
  // Object.prototype.hasOwnProperty-based check) closes it.
  it("throws JoinError for '__proto__' as a join key (prototype-chain lookup bypass)", () => {
    expect(() => validateJoinCondition({ leftKey: "__proto__", rightKey: "source", type: "inner" })).toThrow(JoinError);
  });

  it("throws JoinError for 'constructor' as a join key (prototype-chain lookup bypass)", () => {
    expect(() => validateJoinCondition({ leftKey: "source", rightKey: "constructor", type: "inner" })).toThrow(JoinError);
  });

  it("throws JoinError for invalid join type", () => {
    expect(() => validateJoinCondition({ leftKey: "source", rightKey: "status", type: "cross" as any })).toThrow(JoinError);
  });
});

// ─── Drill-Through Validation ────────────────────────────────────────────────

describe("validateDrillThroughParams", () => {
  it("validates valid params without throwing", () => {
    expect(() => validateDrillThroughParams("report-123", "source=finance")).not.toThrow();
  });

  it("throws DrillThroughError for empty reportId", () => {
    expect(() => validateDrillThroughParams("", "cell-1")).toThrow(DrillThroughError);
  });

  it("throws DrillThroughError for empty cellId", () => {
    expect(() => validateDrillThroughParams("report-1", "")).toThrow(DrillThroughError);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("domain constants", () => {
  it("exports expected operator set", () => {
    expect(CALC_OPERATORS).toEqual(["add", "subtract", "multiply", "divide"]);
  });

  it("exports join types", () => {
    expect(JOIN_TYPES).toEqual(["inner", "left"]);
  });

  it("has sane row caps", () => {
    expect(JOIN_ROW_CAP).toBe(1000);
    expect(DRILL_THROUGH_ROW_CAP).toBe(200);
  });
});

// ─── Scheduled Export Domain ─────────────────────────────────────────────────

describe("computeNextRunAt", () => {
  it("adds 1 hour for hourly cadence", () => {
    const from = new Date("2025-01-15T10:00:00Z");
    const next = computeNextRunAt(from, "hourly");
    expect(next.toISOString()).toBe("2025-01-15T11:00:00.000Z");
  });

  it("adds 24 hours for daily cadence", () => {
    const from = new Date("2025-01-15T10:00:00Z");
    const next = computeNextRunAt(from, "daily");
    expect(next.toISOString()).toBe("2025-01-16T10:00:00.000Z");
  });

  it("adds 7 days for weekly cadence", () => {
    const from = new Date("2025-01-15T10:00:00Z");
    const next = computeNextRunAt(from, "weekly");
    expect(next.toISOString()).toBe("2025-01-22T10:00:00.000Z");
  });

  it("advances to next month for monthly cadence", () => {
    const from = new Date("2025-01-15T10:30:00Z");
    const next = computeNextRunAt(from, "monthly");
    expect(next.toISOString()).toBe("2025-02-15T10:30:00.000Z");
  });

  it("clamps day for monthly when next month has fewer days (Jan 31 → Feb 28)", () => {
    const from = new Date("2025-01-31T08:00:00Z");
    const next = computeNextRunAt(from, "monthly");
    expect(next.toISOString()).toBe("2025-02-28T08:00:00.000Z");
  });

  it("handles December → January year rollover for monthly", () => {
    const from = new Date("2025-12-15T12:00:00Z");
    const next = computeNextRunAt(from, "monthly");
    expect(next.toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("handles leap year Feb 29 correctly", () => {
    const from = new Date("2024-01-31T08:00:00Z"); // 2024 is leap year
    const next = computeNextRunAt(from, "monthly");
    expect(next.toISOString()).toBe("2024-02-29T08:00:00.000Z");
  });
});

describe("isValidCadence", () => {
  it("returns true for valid cadences", () => {
    expect(isValidCadence("hourly")).toBe(true);
    expect(isValidCadence("daily")).toBe(true);
    expect(isValidCadence("weekly")).toBe(true);
    expect(isValidCadence("monthly")).toBe(true);
  });

  it("returns false for invalid cadences", () => {
    expect(isValidCadence("yearly")).toBe(false);
    expect(isValidCadence("")).toBe(false);
    expect(isValidCadence("minutely")).toBe(false);
  });
});
