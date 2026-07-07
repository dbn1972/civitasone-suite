import { z } from "zod";

export const createClauseBody = z.object({
  title: z.string().min(1).max(500),
  category: z.string().min(1).max(100),
  jurisdiction: z.string().min(1).max(100),
  body: z.string().min(1).max(50_000),
  mergeFields: z.array(z.string().min(1).max(200)).max(100).default([]),
});

export type CreateClauseBody = z.infer<typeof createClauseBody>;

export const updateClauseBody = z.object({
  title: z.string().min(1).max(500).optional(),
  category: z.string().min(1).max(100).optional(),
  jurisdiction: z.string().min(1).max(100).optional(),
  body: z.string().min(1).max(50_000).optional(),
  mergeFields: z.array(z.string().min(1).max(200)).max(100).optional(),
  version: z.number().int().positive(),
});

export type UpdateClauseBody = z.infer<typeof updateClauseBody>;

export const clauseIdParam = z.object({
  id: z.string().uuid(),
});

export const clauseListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.string().max(100).optional(),
  jurisdiction: z.string().max(100).optional(),
});

export const deleteClauseBody = z.object({
  version: z.number().int().positive(),
});
