import { z } from "zod";

export const createItemBody = z.object({
  name:            z.string().min(1).max(256),
  code:            z.string().min(1).max(64),
  categoryId:      z.string().uuid(),
  uomId:           z.string().uuid(),
  itemType:        z.enum(["consumable", "fixed_asset", "service"]).default("consumable"),
  reorderLevel:    z.number().int().nonnegative().default(0),
  reorderQty:      z.number().int().nonnegative().default(0),
  valuationMethod: z.enum(["WAVG", "FIFO"]).default("WAVG"),
});
export type CreateItemBody = z.infer<typeof createItemBody>;

export const itemQueryParams = z.object({
  category: z.string().uuid().optional(),
  limit:    z.coerce.number().int().positive().max(200).default(50),
  offset:   z.coerce.number().int().nonnegative().default(0),
});

export const idParam = z.object({ id: z.string().uuid() });
