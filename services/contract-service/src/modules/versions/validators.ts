import { z } from "zod";

export const createVersionBody = z.object({
  content: z.string().min(1),
});

export type CreateVersionBody = z.infer<typeof createVersionBody>;

export const contractIdParam = z.object({
  id: z.string().uuid(),
});

export const versionParam = z.object({
  id: z.string().uuid(),
  vn: z.coerce.number().int().min(1).max(100),
});

export const versionListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
