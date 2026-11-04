import { z } from "zod";

/**
 * UAT ux-docs (PR #2463 review): GST slabs a PO line may carry, in basis points. Default
 * 0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28 and 40 % (GST 2.0 added the 40 % slab; 12 and 28 stay
 * for legacy lines). Configurable with PO_GST_ALLOWED_RATES (comma-separated percent values).
 */
export const DEFAULT_GST_ALLOWED_RATES_BP: readonly number[] = [0, 10, 25, 150, 300, 500, 1200, 1800, 2800, 4000];

export function gstAllowedRatesBp(env: string | undefined = process.env.PO_GST_ALLOWED_RATES): readonly number[] {
  if (!env || !env.trim()) return DEFAULT_GST_ALLOWED_RATES_BP;
  const list = env.split(",").map((v) => Math.round(Number(v.trim()) * 100)).filter((v) => Number.isInteger(v) && v >= 0 && v <= 4000);
  return list.length > 0 ? [...new Set(list)].sort((a, b) => a - b) : DEFAULT_GST_ALLOWED_RATES_BP;
}

const gstRateBp = z.number().int().refine((v) => gstAllowedRatesBp().includes(v), {
  message: "GST rate must be one of the allowed slabs (0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28, 40 %)",
});

const poItemSchema = z.object({
  itemCode:       z.string().min(1).max(64),
  description:    z.string().min(1).max(500),
  quantity:       z.number().int().positive(),
  unit:           z.string().min(1).max(32).default("nos"),
  unitPriceMinor: z.number().int().nonnegative(),
  itemType:       z.enum(["consumable", "fixed_asset", "service"]).default("consumable"),
  // UAT ux-docs: GST rate of the line in basis points (1800 = 18%) and its HSN/SAC code, printed on the PO.
  gstRateBp:      gstRateBp.optional(),
  hsnSac:         z.string().trim().regex(/^\d{4,8}$/, "HSN/SAC is 4 to 8 digits").optional(),
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
  // D4c #28: required (one of the two) only when the vendor has NO empanelment
  // record - the awarded tender the vendor won, or a GeM order reference.
  tenderId:        z.string().uuid().optional(),
  gemOrderRef:     z.string().trim().max(128).optional(),
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

// F102: direct PO reject (same shape as rejectIndentBody).
export const rejectPoBody = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectPoBody = z.infer<typeof rejectPoBody>;

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
