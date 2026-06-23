import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createActivityBody = z.object({
  actorName: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(2000),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  type: z.enum(["call", "meeting", "email", "task", "note"]).default("note"),
  subject: z.string().max(200).optional(),
  status: z.enum(["open", "completed", "cancelled"]).default("open"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateActivityBody = z.infer<typeof createActivityBody>;

export const activityViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  actorName: z.string(),
  text: z.string(),
  contactId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  type: z.string(),
  subject: z.string().nullable().optional(),
  status: z.string(),
  dueDate: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const activitiesListSchema = paginatedSchema(activityViewSchema);
