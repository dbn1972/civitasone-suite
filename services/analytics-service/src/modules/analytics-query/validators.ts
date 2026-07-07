/**
 * Zod validators for analytics query routes:
 * - POST /v1/analytics/query (joins + calculated fields)
 * - GET /v1/analytics/drill-through/:reportId/:cellId
 */
import { z } from "zod";
import { METRIC_KEYS, DIMENSION_KEYS, FILTER_KEYS, OPERATORS } from "../registry/registry.js";
import { CALC_OPERATORS, JOIN_TYPES, MAX_CALCULATED_FIELDS, MAX_EXPRESSION_LENGTH } from "./domain.js";

// ─── Calculated Field Expression Schema ──────────────────────────────────────

const calcOperandSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("column"), key: z.string().min(1).max(64) }),
    z.object({ type: z.literal("literal"), value: z.number().finite() }),
    z.object({ type: z.literal("expression"), expr: calcExpressionSchema }),
  ]),
);

const calcExpressionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    op: z.enum(CALC_OPERATORS),
    left: calcOperandSchema,
    right: calcOperandSchema,
  }),
);

const calculatedFieldSchema = z.object({
  alias: z.string().min(1).max(64),
  expression: calcExpressionSchema,
});

// ─── Filter Schema (reuse from spec) ────────────────────────────────────────

const filterSchema = z.object({
  field: z.enum(FILTER_KEYS),
  op: z.enum(OPERATORS),
  value: z.union([
    z.string().max(256),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string().max(256), z.number()])).max(100),
  ]),
});

// ─── Join Condition Schema ───────────────────────────────────────────────────

const joinConditionSchema = z.object({
  leftKey: z.string().min(1).max(64),
  rightKey: z.string().min(1).max(64),
  type: z.enum(JOIN_TYPES).default("inner"),
});

// ─── Analytics Query Body (POST /v1/analytics/query) ─────────────────────────

export const analyticsQueryBody = z
  .object({
    /** Metrics to aggregate. */
    metrics: z.array(z.enum(METRIC_KEYS)).min(1).max(5),
    /** Dimensions to group by. */
    dimensions: z.array(z.enum(DIMENSION_KEYS)).max(4).default([]),
    /** Filters on whitelisted fields. */
    filters: z.array(filterSchema).max(20).default([]),
    /** ISO date bounds. */
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    /** Cross-table join conditions (max 3 joins per query). */
    joins: z.array(joinConditionSchema).max(3).default([]),
    /** Calculated fields (max 10 per query, expression max 500 chars serialized). */
    calculatedFields: z
      .array(calculatedFieldSchema)
      .max(MAX_CALCULATED_FIELDS)
      .default([]),
    /** Row limit (capped at 1000 for join queries). */
    limit: z.number().int().min(1).max(1000).default(100),
  })
  .strict()
  .refine(
    (data) => {
      // Validate calculated field expression lengths
      for (const cf of data.calculatedFields) {
        if (JSON.stringify(cf.expression).length > MAX_EXPRESSION_LENGTH) {
          return false;
        }
      }
      return true;
    },
    { message: `calculated field expression exceeds ${MAX_EXPRESSION_LENGTH} characters` },
  );

export type AnalyticsQueryBody = z.infer<typeof analyticsQueryBody>;

// ─── Drill-Through Params ────────────────────────────────────────────────────

export const drillThroughParams = z.object({
  reportId: z.string().uuid(),
  cellId: z.string().min(1).max(128),
});

export type DrillThroughParams = z.infer<typeof drillThroughParams>;

export const drillThroughQuery = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = v ? parseInt(v, 10) : 200;
      return Math.min(Math.max(n, 1), 200);
    }),
  offset: z
    .string()
    .optional()
    .transform((v) => {
      const n = v ? parseInt(v, 10) : 0;
      return Math.max(n, 0);
    }),
});

export type DrillThroughQuery = z.infer<typeof drillThroughQuery>;

// ─── Response Schemas ────────────────────────────────────────────────────────

export const analyticsQueryResultSchema = z.object({
  data: z.object({
    rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
    rowCount: z.number().int(),
    metrics: z.array(z.string()),
    dimensions: z.array(z.string()),
    calculatedFields: z.array(z.string()),
  }),
});

export const drillThroughResultSchema = z.object({
  data: z.object({
    rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
    rowCount: z.number().int(),
    reportId: z.string(),
    cellId: z.string(),
  }),
});
