/**
 * QuerySpec — the validated, structured description of an analytics query.
 * This is the ONLY thing a user can submit. There is no free-text SQL field.
 */
import { z } from "zod";
import { METRIC_KEYS, DIMENSION_KEYS, FILTER_KEYS, OPERATORS } from "./registry.js";

/** A single filter predicate. Field + operator are whitelisted; value is bound. */
export const filterSchema = z.object({
  field: z.enum(FILTER_KEYS),
  op: z.enum(OPERATORS),
  // string | number | boolean | array of string|number (for `in`)
  value: z.union([
    z.string().max(256),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string().max(256), z.number()])).max(100),
  ]),
});
export type FilterSpec = z.infer<typeof filterSchema>;

export const querySpecSchema = z
  .object({
    metric: z.enum(METRIC_KEYS),
    dimensions: z.array(z.enum(DIMENSION_KEYS)).max(4).default([]),
    filters: z.array(filterSchema).max(20).default([]),
    /** inclusive ISO date bounds applied to occurred_at */
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

export type QuerySpec = z.infer<typeof querySpecSchema>;

/** A single aggregated result row: dimension values + the numeric metric value. */
export type QueryResultRow = Record<string, string | number>;

export interface QueryResult {
  metric: string;
  dimensions: string[];
  rows: QueryResultRow[];
  rowCount: number;
}
