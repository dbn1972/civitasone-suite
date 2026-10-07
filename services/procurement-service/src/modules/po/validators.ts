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
  // GAP-PROCUREMENT-ORDERS-NEW-02: poNo is issued by the server from a
  // per-tenant, per-FY gapless sequence (consumer.ts → allocateDocNo). It is
  // optional on input and any client-supplied value is IGNORED — accepted only
  // for backward compatibility with older callers that still send one.
  poNo:            z.string().min(1).max(64).optional(),
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

/** Real calendar date, YYYY-MM-DD (bound for a DATE column; a malformed value
 *  would otherwise become a poison message in the consumer). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").refine(
  (v) => { const d = new Date(v + "T00:00:00.000Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; },
  "must be a real calendar date",
);

export const dispatchBody = z.object({
  notes: z.string().max(500).optional(),
  // GAP-PROCUREMENT-ORDERS-DETAIL-03: optional structured dispatch metadata so
  // the officer can record HOW the PO was sent and the expected delivery date,
  // rather than a fixed "Dispatched from web UI" note.
  mode: z.enum(["email", "portal", "courier", "hand", "gem", "other"]).optional(),
  expectedDelivery: isoDate.optional(),
});
export type DispatchBody = z.infer<typeof dispatchBody>;

export const idParam = z.object({ id: z.string().uuid() });
