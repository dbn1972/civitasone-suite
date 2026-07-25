import { z } from "zod";

const poItemSchema = z.object({
  itemCode:       z.string().min(1).max(64),
  description:    z.string().min(1).max(500),
  quantity:       z.number().int().positive(),
  unit:           z.string().min(1).max(32).default("nos"),
  unitPriceMinor: z.number().int().nonnegative(),
  itemType:       z.enum(["consumable", "fixed_asset", "service"]).default("consumable"),
});

export const createPoBody = z.object({
  poNo:            z.string().min(1).max(64),
  vendorId:        z.string().uuid(),
  indentRef:       z.string().min(1),
  sanctionRef:     z.string().optional(),
  rateContractRef: z.string().optional(),
  // SVC-046: supply Purchase Order (default) vs service / work order.
  orderType:       z.enum(["supply", "service", "work"]).default("supply"),
  deliveryDate:    z.string().optional(),
  items:           z.array(poItemSchema).min(1),
});
export type CreatePoBody = z.infer<typeof createPoBody>;

export const gemOrderBody = z.object({
  poNo:         z.string().min(1).max(64),
  vendorId:     z.string().uuid(),
  indentRef:    z.string().min(1),
  sanctionRef:  z.string().optional(),
  gemOrderNo:   z.string().min(1).max(128),
  deliveryDate: z.string().optional(),
  items:        z.array(poItemSchema).min(1),
});
export type GemOrderBody = z.infer<typeof gemOrderBody>;

export const dispatchBody = z.object({
  notes: z.string().max(500).optional(),
});
export type DispatchBody = z.infer<typeof dispatchBody>;

export const idParam = z.object({ id: z.string().uuid() });
