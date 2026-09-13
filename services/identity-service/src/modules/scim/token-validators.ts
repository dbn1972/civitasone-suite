import { z } from "zod";

export const issueScimTokenBody = z.object({
  name:      z.string().min(1).max(200),
  expiresAt: z.string().datetime().optional(),
});
export type IssueScimTokenBody = z.infer<typeof issueScimTokenBody>;

export const scimTokenIdParam = z.object({ id: z.string().uuid() });
