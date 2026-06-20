import { z } from "zod";

export const createPlanBody = z.object({
  name: z.string().min(2).max(200),
  code: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/i),
  priceMinor: z.number().int().min(0),
  currency: z.string().length(3).default("INR"),
  govtExempt: z.boolean().default(true),
});

export const idParam = z.object({ id: z.string().uuid() });
