import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const cancelIrnBody = z.object({
  reason: z.string().min(1).max(500),
});
export type CancelIrnBody = z.infer<typeof cancelIrnBody>;
