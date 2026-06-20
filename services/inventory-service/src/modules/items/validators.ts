/** zod validators — applied at the route boundary. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createItemBody = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().min(1).max(64).optional(),
});
export type CreateItemBody = z.infer<typeof createItemBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const itemViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const itemsListSchema = paginatedSchema(itemViewSchema);
