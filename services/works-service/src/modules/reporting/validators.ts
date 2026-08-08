import { z } from "zod";
import { paginationSchema } from "../masters/validators.js";

export const reportFiltersSchema = paginationSchema.extend({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  divisionId: z.string().uuid().optional(),
});

export type ReportFiltersInput = z.infer<typeof reportFiltersSchema>;

export interface ReportFilters {
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  divisionId?: string | undefined;
  page: number;
  pageSize: number;
}

export function parseReportFilters(query: ReportFiltersInput): ReportFilters {
  return {
    fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
    toDate: query.toDate ? new Date(query.toDate) : undefined,
    divisionId: query.divisionId,
    page: query.page,
    pageSize: query.pageSize,
  };
}
