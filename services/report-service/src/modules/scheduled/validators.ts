/** zod validators — applied at the route boundary for scheduled report operations. */
import { z } from "zod";

export const cadenceEnum = z.enum(["hourly", "daily", "weekly", "monthly"]);

export const createScheduledReportBody = z.object({
  templateId: z.string().uuid(),
  cadence: cadenceEnum,
  recipients: z.array(z.string().email()).min(1).max(20),
  format: z.enum(["pdf", "xlsx", "csv"]).default("pdf"),
});
export type CreateScheduledReportBody = z.infer<typeof createScheduledReportBody>;

export const updateScheduledReportBody = z.object({
  cadence: cadenceEnum.optional(),
  recipients: z.array(z.string().email()).min(1).max(20).optional(),
  format: z.enum(["pdf", "xlsx", "csv"]).optional(),
  enabled: z.boolean().optional(),
  version: z.number().int().min(1),
});
export type UpdateScheduledReportBody = z.infer<typeof updateScheduledReportBody>;

export const idParam = z.object({ id: z.string().uuid() });
