import { z } from "zod";

export const createConfigBody = z.object({
  name: z.string().min(1).max(200),
  horizons: z.array(z.number().int().min(1).max(365)).min(1).max(10).default([60, 30, 7]),
  groupBy: z.enum(["product", "region", "owner"]).default("product"),
  consentRequired: z.boolean().default(true),
  active: z.boolean().default(true),
});

export const patchConfigBody = z.object({
  name: z.string().min(1).max(200).optional(),
  horizons: z.array(z.number().int().min(1).max(365)).min(1).max(10).optional(),
  groupBy: z.enum(["product", "region", "owner"]).optional(),
  consentRequired: z.boolean().optional(),
  active: z.boolean().optional(),
  version: z.number().int().min(1),
});

export const idParam = z.object({ id: z.string().uuid() });

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const runsListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  configId: z.string().uuid().optional(),
});

export type CreateConfigBody = z.infer<typeof createConfigBody>;
export type PatchConfigBody = z.infer<typeof patchConfigBody>;
