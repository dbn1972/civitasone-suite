import { z } from "zod";

export const createRuleBody = z.object({
  segmentCode: z.string().min(1).max(64),
  productId: z.string().uuid(),
  eligible: z.boolean().default(true),
  channelOverride: z.array(z.string().min(1).max(32)).max(10).nullable().default(null),
});
export type CreateRuleBody = z.infer<typeof createRuleBody>;

export const updateRuleBody = z.object({
  eligible: z.boolean().optional(),
  channelOverride: z.array(z.string().min(1).max(32)).max(10).nullable().optional(),
  version: z.number().int().min(1),
});
export type UpdateRuleBody = z.infer<typeof updateRuleBody>;

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  segmentCode: z.string().min(1).max(64).optional(),
  productId: z.string().uuid().optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

export const idParam = z.object({ id: z.string().uuid() });
