import { z } from "zod";

export const granularityQuery = z.object({
  granularity: z.enum(["month", "fy"]).default("month"),
});

export const agingQuery = z.object({
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "asOf must be YYYY-MM-DD")
    .optional(),
});

export const defaultersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

export const forecastBody = z.object({
  method: z.enum(["moving_average", "straight_line", "seasonal_naive"]).default("moving_average"),
  granularity: z.enum(["month", "fy"]).default("month"),
  horizon: z.coerce.number().int().min(1).max(24).default(3),
  /** MA window / seasonal cycle length. */
  param: z.coerce.number().int().min(1).max(24).default(3),
  /** Persist the run to analytics.forecast_runs. */
  persist: z.boolean().default(false),
  rateHeadId: z.string().uuid().optional(),
});
