/**
 * visitor-service: analytics route zod validators.
 *
 * Validates query parameters for the /daily, /trends, and /export endpoints.
 */
import { z } from "zod";

/** GET /v1/visitor/analytics/daily — date + optional locationId. */
export const dailyQuery = z.object({
  date: z.string().datetime({ message: "date must be an ISO timestamp" }),
  locationId: z.string().uuid("invalid locationId").optional(),
});
export type DailyQuery = z.infer<typeof dailyQuery>;

/** GET /v1/visitor/analytics/trends — period, dateFrom, dateTo. */
export const trendsQuery = z.object({
  period: z.enum(["weekly", "monthly"], { message: "period must be 'weekly' or 'monthly'" }),
  dateFrom: z.string().datetime({ message: "dateFrom must be an ISO timestamp" }),
  dateTo: z.string().datetime({ message: "dateTo must be an ISO timestamp" }),
  locationId: z.string().uuid("invalid locationId").optional(),
});
export type TrendsQuery = z.infer<typeof trendsQuery>;

/** GET /v1/visitor/analytics/export — configurable date range for CSV export. */
export const exportQuery = z.object({
  dateFrom: z.string().datetime({ message: "dateFrom must be an ISO timestamp" }),
  dateTo: z.string().datetime({ message: "dateTo must be an ISO timestamp" }),
  locationId: z.string().uuid("invalid locationId").optional(),
});
export type ExportQuery = z.infer<typeof exportQuery>;
