/** zod validators for scheduled-jobs commands. */
import { z } from "zod";

/** Validate cron expression (5 or 6 parts). */
const cronRegex = /^(\*(?:\/\d+)?|[0-9,\-\/\*]+)\s+(\*(?:\/\d+)?|[0-9,\-\/\*]+)\s+(\*(?:\/\d+)?|[0-9,\-\/\*]+)\s+(\*(?:\/\d+)?|[0-9,\-\/\*]+)\s+(\*(?:\/\d+)?|[0-9,\-\/\*]+)(\s+(\*(?:\/\d+)?|[0-9,\-\/\*]+))?$/;

export const cronExpressionSchema = z.string().min(5).max(100).regex(cronRegex, "Invalid cron expression");

export const createJobBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  cronExpression: cronExpressionSchema,
  timezone: z.string().min(1).max(50).default("Asia/Kolkata"),
  targetService: z.string().min(1).max(100),
  targetCommand: z.string().min(1).max(200),
  payload: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});
export type CreateJobBody = z.infer<typeof createJobBody>;

export const updateJobBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  cronExpression: cronExpressionSchema.optional(),
  timezone: z.string().min(1).max(50).optional(),
  targetService: z.string().min(1).max(100).optional(),
  targetCommand: z.string().min(1).max(200).optional(),
  payload: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
export type UpdateJobBody = z.infer<typeof updateJobBody>;

export const jobIdParam = z.object({ id: z.string().uuid() });
