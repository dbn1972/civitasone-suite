import { z } from "zod";

export const createAssetBody = z.object({
  name:            z.string().min(1).max(256),
  code:            z.string().min(1).max(64),
  categoryId:      z.string().uuid(),
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
});
export type CreateAssetBody = z.infer<typeof createAssetBody>;

export const assetQueryParams = z.object({
  category: z.string().uuid().optional(),
  status:   z.string().optional(),
  limit:    z.coerce.number().int().positive().max(200).default(50),
  offset:   z.coerce.number().int().nonnegative().default(0),
});

export const idParam = z.object({ id: z.string().uuid() });
