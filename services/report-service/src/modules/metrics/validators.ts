/** zod validators — applied at the route boundary for metric definition operations. */
import { z } from "zod";
import { AGGREGATIONS, GOVERNANCES, PERIODS, STATUSES, MAX_DIMENSIONS } from "./domain.js";

/** Decimal literal accepted for numeric columns — kept as a string so no precision is lost. */
const DECIMAL = /^-?\d{1,24}(\.\d{1,8})?$/;

const decimalLike = z
  .union([z.string().regex(DECIMAL, "must be a decimal number"), z.number().finite()])
  .transform((v) => String(v));

export const idParam = z.object({ id: z.string().uuid() });

export const metricKeyParam = z.object({ metricKey: z.string().min(3).max(96) });

export const listMetricsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  module: z.string().min(1).max(64).optional(),
  status: z.enum(STATUSES).optional(),
  governance: z.enum(GOVERNANCES).optional(),
  metricKey: z.string().min(1).max(96).optional(),
});
export type ListMetricsQuery = z.infer<typeof listMetricsQuery>;

export const createMetricBody = z.object({
  metricKey: z.string().min(3).max(96),
  displayName: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  module: z.string().min(1).max(64),
  unit: z.string().min(1).max(32),
  aggregation: z.enum(AGGREGATIONS),
  numeratorSource: z.string().min(3).max(200),
  denominatorSource: z.string().min(3).max(200).optional(),
  dimensions: z.array(z.string().min(1).max(64)).max(MAX_DIMENSIONS).default([]),
  period: z.enum(PERIODS),
  targetValue: decimalLike.optional(),
  higherIsBetter: z.boolean().default(true),
  governance: z.enum(GOVERNANCES).default("tenant"),
});
export type CreateMetricBody = z.infer<typeof createMetricBody>;

export const updateMetricBody = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  module: z.string().min(1).max(64).optional(),
  metricKey: z.string().min(3).max(96).optional(),
  unit: z.string().min(1).max(32).optional(),
  aggregation: z.enum(AGGREGATIONS).optional(),
  numeratorSource: z.string().min(3).max(200).optional(),
  denominatorSource: z.string().min(3).max(200).nullable().optional(),
  dimensions: z.array(z.string().min(1).max(64)).max(MAX_DIMENSIONS).optional(),
  period: z.enum(PERIODS).optional(),
  targetValue: decimalLike.nullable().optional(),
  higherIsBetter: z.boolean().optional(),
  /** Optimistic lock — mismatch is rejected with 409 VERSION_CONFLICT. */
  version: z.number().int().positive(),
});
export type UpdateMetricBody = z.infer<typeof updateMetricBody>;

/** publish / deprecate / new-version take the optimistic lock only. */
export const transitionBody = z.object({
  version: z.number().int().positive(),
});
export type TransitionBody = z.infer<typeof transitionBody>;
