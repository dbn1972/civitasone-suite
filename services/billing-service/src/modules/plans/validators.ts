import { z } from "zod";
import { PLAN_INTERVALS } from "./domain.js";

export const createPlanBody = z.object({
  name: z.string().min(2).max(200),
  code: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/i),
  priceMinor: z.number().int().min(0),
  currency: z.string().length(3).default("INR"),
  govtExempt: z.boolean().default(true),
  // GAP-BILLING-PLANS-NEW-01: optional so older clients keep working (monthly).
  interval: z.enum(PLAN_INTERVALS).default("monthly"),
});

export const idParam = z.object({ id: z.string().uuid() });
