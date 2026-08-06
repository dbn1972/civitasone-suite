import { z } from "zod";

export const createSLAPolicyBody = z.object({
  stageCode: z.string().min(1).max(60),
  slaHours: z.number().int().min(1).max(87600), // max ~10 years
  warnAtPercent: z.number().int().min(1).max(99).default(80),
  breachAction: z.enum(["notify", "escalate", "both"]).default("notify"),
  notifyRoles: z.array(z.string().min(1).max(64)).default([]),
  escalationTargetId: z.string().uuid().nullable().optional(),
  active: z.boolean().default(true),
});

export const updateSLAPolicyBody = z.object({
  slaHours: z.number().int().min(1).max(87600).optional(),
  warnAtPercent: z.number().int().min(1).max(99).optional(),
  breachAction: z.enum(["notify", "escalate", "both"]).optional(),
  notifyRoles: z.array(z.string().min(1).max(64)).optional(),
  escalationTargetId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});

export const listSLAPolicyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  active: z.enum(["true", "false"]).optional(),
});

export const idParam = z.object({ id: z.string().uuid() });
