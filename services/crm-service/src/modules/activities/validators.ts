import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createActivityBody = z.object({
  actorName: z.string().min(1).max(200),
  text: z.string().min(1).max(2000),
});
export type CreateActivityBody = z.infer<typeof createActivityBody>;

export const activityViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  actorName: z.string(),
  text: z.string(),
  createdAt: z.string(),
});

export const activitiesListSchema = paginatedSchema(activityViewSchema);
