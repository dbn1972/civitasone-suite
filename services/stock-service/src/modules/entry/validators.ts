import { z } from "zod";

const entryItemSchema = z.object({
  itemId:    z.string().uuid(),
  qty:       z.number().int().positive(),
  rateMinor: z.number().int().nonnegative().default(0),
  currency:  z.string().length(3).default("INR"),
});

export const createEntryBody = z.object({
  entryType:       z.enum(["receipt", "issue", "transfer", "adjustment"]),
  refDoc:          z.string().optional(),
  refNo:           z.string().optional(),
  postingDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromWarehouseId: z.string().uuid().optional(),
  toWarehouseId:   z.string().uuid().optional(),
  notes:           z.string().optional(),
  items:           z.array(entryItemSchema).min(1),
});
export type CreateEntryBody = z.infer<typeof createEntryBody>;

export const physicalVerificationBody = z.object({
  warehouseId:  z.string().uuid(),
  postingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items:        z.array(z.object({ itemId: z.string().uuid(), countedQty: z.number().int().nonnegative() })),
  notes:        z.string().optional(),
});
export type PhysicalVerificationBody = z.infer<typeof physicalVerificationBody>;

export const ledgerQueryParams = z.object({
  itemId:      z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  from:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:       z.coerce.number().int().positive().max(500).default(100),
  offset:      z.coerce.number().int().nonnegative().default(0),
});

export const valuationQueryParams = z.object({
  itemId:      z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
});

export const idParam = z.object({ id: z.string().uuid() });
