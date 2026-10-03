/** zod validators -- applied at the route boundary AND at the consume boundary. */
import { z } from "zod";

export const createItemLinkBody = z.object({
  inventoryItemId: z.string().uuid(),
  stockItemId:     z.string().uuid(),
  /** `suggested` when the admin confirmed an exact code/sku auto-suggestion. */
  source:          z.enum(["manual", "suggested"]).default("manual"),
});
export type CreateItemLinkBody = z.infer<typeof createItemLinkBody>;

export const createItemLinkPayload = createItemLinkBody.extend({
  id:            z.string().uuid(),
  tenantId:      z.string().uuid(),
  stockItemCode: z.string().min(1).max(64),
  stockItemName: z.string().min(1).max(256),
});

export const removeItemLinkPayload = z.object({
  id:       z.string().uuid(),
  tenantId: z.string().uuid(),
});

export const linkListQuery = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const linkLookupQuery = z.object({
  inventoryItemId: z.string().uuid().optional(),
  stockItemId:     z.string().uuid().optional(),
}).refine((q) => (q.inventoryItemId === undefined) !== (q.stockItemId === undefined), {
  message: "provide exactly one of inventoryItemId or stockItemId",
});

export const pickerQuery = z.object({
  q:       z.string().trim().max(100).default(""),
  limit:   z.coerce.number().int().positive().max(50).default(20),
  /** `stock` narrows to items that have a stock-service side (linked or stock-only), for stock entry forms. */
  masters: z.enum(["all", "stock"]).default("all"),
});

export const unmatchedQuery = z.object({
  limit: z.coerce.number().int().positive().max(1000).default(200),
});

export const idParam = z.object({ id: z.string().uuid() });
