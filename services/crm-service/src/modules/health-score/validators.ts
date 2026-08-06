import { z } from "zod";

export const createConfigBody = z.object({
  signalName: z.string().min(1).max(100),
  weight: z.number().int().min(0).max(100),
  decayDays: z.number().int().min(1).default(90),
  source: z.enum(["activity", "ticket", "deal", "payment"]),
  enabled: z.boolean().default(true),
});

export const updateConfigBody = z.object({
  weight: z.number().int().min(0).max(100).optional(),
  decayDays: z.number().int().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const configIdParam = z.object({ id: z.string().uuid() });

export const accountIdParam = z.object({ accountId: z.string().uuid() });

export const listConfigsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  source: z.enum(["activity", "ticket", "deal", "payment"]).optional(),
});
