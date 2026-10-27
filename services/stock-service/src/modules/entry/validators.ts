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
  // GAP-STOCK-LEDGER-NEW-04: structured audit reason (kept optional: receipts and legacy callers send none).
  reason:          z.string().trim().min(1).max(500).optional(),
  items:           z.array(entryItemSchema).min(1),
}).superRefine((b, ctx) => {
  // GAP-STOCK-LEDGER-NEW-01: a transfer moves stock between two warehouses; without both ids the
  // consumer would silently post only one leg and misstate inventory.
  if (b.entryType !== "transfer") return;
  if (!b.fromWarehouseId) ctx.addIssue({ code: "custom", path: ["fromWarehouseId"], message: "required for a transfer" });
  if (!b.toWarehouseId) ctx.addIssue({ code: "custom", path: ["toWarehouseId"], message: "required for a transfer" });
  if (b.fromWarehouseId && b.toWarehouseId && b.fromWarehouseId === b.toWarehouseId) {
    ctx.addIssue({ code: "custom", path: ["toWarehouseId"], message: "must differ from the source warehouse" });
  }
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
  itemId:      z.string().uuid().optional(),
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
