import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createItemBody = z.object({
  name: z.string().min(1).max(200),
  semver: z.string().min(1).max(32),
  description: z.string().max(500).optional(),
});
export type CreateItemBody = z.infer<typeof createItemBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const itemViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  semver: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const itemsListSchema = paginatedSchema(itemViewSchema);
