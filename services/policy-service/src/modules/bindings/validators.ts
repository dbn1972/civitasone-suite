import { z } from "zod";

export const createBindingBody = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});
export type CreateBindingBody = z.infer<typeof createBindingBody>;

export const breakglassBody = z.object({
  scope:           z.string().min(1).max(256),
  reason:          z.string().min(10).max(2000),
  durationMinutes: z.number().int().min(1).max(1440).default(60),
});
export type BreakglassBody = z.infer<typeof breakglassBody>;

export const bindingIdParam = z.object({ id: z.string().uuid() });
