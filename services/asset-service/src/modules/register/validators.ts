import { z } from "zod";

export const createAssetBody = z.object({
  name:            z.string().min(1).max(256),
  code:            z.string().min(1).max(64),
  categoryId:      z.string().uuid(),
  assetType:       z.enum(["fixed", "infra", "movable", "it", "vehicle", "other"]).default("other"),
  acquisitionCost: z.number().int().nonnegative(),
  salvageValue:    z.number().int().nonnegative().default(0),
  usefulLifeYears: z.number().int().positive().default(5),
  depRate:         z.number().positive().default(20),
  depMethod:       z.enum(["SLM", "WDV"]).default("SLM"),
  currency:        z.string().length(3).default("INR"),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  poRef:           z.string().optional(),
  grnRef:          z.string().optional(),
  location:        z.string().optional(),
  notes:           z.string().optional(),
  barcode:         z.string().optional(),
});

// GAP-ASSETS-DETAIL-03: a barcode is printed and scanned back -- reject
// markup / quote / control characters so a stored value can never carry HTML.
const BARCODE_MARKUP = /[<>"'`&]/;
export function isSafeBarcode(v: string): boolean {
  if (BARCODE_MARKUP.test(v)) return false;
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
}
export const tagBarcodeBody = z.object({
  barcode: z.string().trim().min(1).max(128).refine(isSafeBarcode, {
    message: "barcode may not contain markup, quote or control characters",
  }),
});
export type CreateAssetBody = z.infer<typeof createAssetBody>;

export const assetQueryParams = z.object({
  category: z.string().uuid().optional(),
  status:   z.string().optional(),
  type:     z.enum(["fixed", "infra", "movable", "it", "vehicle", "other"]).optional(),
  search:   z.string().optional(),
  limit:    z.coerce.number().int().positive().max(200).default(50),
  offset:   z.coerce.number().int().nonnegative().default(0),
});

export const idParam = z.object({ id: z.string().uuid() });

export const createCategoryBody = z.object({
  name:            z.string().min(1).max(256),
  code:            z.string().min(1).max(64),
  depMethod:       z.enum(["SLM", "WDV"]).default("SLM"),
  depRate:         z.number().positive().default(20),
  usefulLifeYears: z.number().int().positive().default(5),
});
export const updateCategoryBody = createCategoryBody.partial();
export type CreateCategoryBody = z.infer<typeof createCategoryBody>;
export type UpdateCategoryBody = z.infer<typeof updateCategoryBody>;
