import { z } from "zod";

export const createRetentionPolicyBody = z.object({
  name: z.string().min(1).max(200),
  categoryId: z.string().uuid().optional(),
  retentionYears: z.number().int().min(1).max(100),
  retentionDays: z.number().int().min(0).max(36500).optional(),
  action: z.enum(["archive", "destroy"]),
  notifyBefore: z.number().int().min(1).max(365).optional(),
  reminderMonths: z.number().int().min(1).max(60).default(3),
});
export type CreateRetentionPolicyBody = z.infer<typeof createRetentionPolicyBody>;

export const updateRetentionPolicyBody = z.object({
  name: z.string().min(1).max(200).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  retentionYears: z.number().int().min(1).max(100).optional(),
  retentionDays: z.number().int().min(0).max(36500).optional(),
  action: z.enum(["archive", "destroy"]).optional(),
  notifyBefore: z.number().int().min(1).max(365).optional(),
  reminderMonths: z.number().int().min(1).max(60).optional(),
});
export type UpdateRetentionPolicyBody = z.infer<typeof updateRetentionPolicyBody>;
