import { z } from "zod";

export const uuidParam = z.object({ id: z.string().uuid() });

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const bigintString = z.string().regex(/^\d+$/, "must be a non-negative integer string");
