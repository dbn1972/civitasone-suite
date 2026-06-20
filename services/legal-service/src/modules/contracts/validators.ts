import { z } from "zod";

export const createReviewBody = z.object({
  contractRef: z.string().min(1).max(256),
  subject:     z.string().min(1).max(256),
  valueMinor:  z.number().int().nonnegative(),
  currency:    z.string().length(3).default("INR"),
});
export type CreateReviewBody = z.infer<typeof createReviewBody>;

export const clearReviewBody = z.object({
  clearanceType: z.string().min(1).max(32),
  notes:         z.string().max(1000).optional(),
});
export type ClearReviewBody = z.infer<typeof clearReviewBody>;

export const idParam = z.object({ id: z.string().uuid() });
