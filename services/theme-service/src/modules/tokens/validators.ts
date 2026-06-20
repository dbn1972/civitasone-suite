import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createTokenBody = z.object({
  name: z.string().min(1).max(128),
  value: z.string().min(1).max(512),
  category: z.string().min(1).max(64).optional(),
});
export type CreateTokenBody = z.infer<typeof createTokenBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const tokenViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  value: z.string(),
  category: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const tokensListSchema = paginatedSchema(tokenViewSchema);
