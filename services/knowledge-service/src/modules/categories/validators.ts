import { z } from "zod";

export const createCategoryBody = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  parentId: z.string().uuid().optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(64).optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateCategoryBody = z.infer<typeof createCategoryBody>;

export const updateCategoryBody = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type UpdateCategoryBody = z.infer<typeof updateCategoryBody>;

export const reorderCategoryBody = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    sortOrder: z.number().int().min(0),
  })).min(1),
});
export type ReorderCategoryBody = z.infer<typeof reorderCategoryBody>;
