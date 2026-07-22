/**
 * visitor-service: analytics route zod validators.
 *
 * Validates query parameters for the /daily, /trends, and /export endpoints.
 */
import { z } from "zod";

/** ISO date (YYYY-MM-DD) or full ISO datetime — both accepted for query convenience. */
const dateOrDatetime = z.string().refine(
  (v) => /^\d{4}-\d{2}-\d{2}(T.+)?$/.test(v),
  { message: "must be a date (YYYY-MM-DD) or ISO timestamp" },
);

/** GET /v1/visitor/analytics/daily — date + optional locationId. */
export const dailyQuery = z.object({
  date: dateOrDatetime,
  locationId: z.string().uuid("invalid locationId").optional(),
});
export type DailyQuery = z.infer<typeof dailyQuery>;

/** GET /v1/visitor/analytics/trends — period, dateFrom, dateTo. */
export const trendsQuery = z.object({
  period: z.enum(["weekly", "monthly"], { message: "period must be 'weekly' or 'monthly'" }),
  dateFrom: dateOrDatetime,
  dateTo: dateOrDatetime,
  locationId: z.string().uuid("invalid locationId").optional(),
});
export type TrendsQuery = z.infer<typeof trendsQuery>;

/** GET /v1/visitor/analytics/export — configurable date range for CSV export. */
export const exportQuery = z.object({
  dateFrom: dateOrDatetime,
  dateTo: dateOrDatetime,
  locationId: z.string().uuid("invalid locationId").optional(),
});
export type ExportQuery = z.infer<typeof exportQuery>;
