import { z } from "zod";

const itemSchema = z.object({
  itemCode:       z.string().min(1).max(64),
  description:    z.string().min(1).max(500),
  quantity:       z.number().int().positive(),
  unit:           z.string().min(1).max(32).default("nos"),
  unitPriceMinor: z.number().int().nonnegative(),
});

export const createIndentBody = z.object({
  indentNo:    z.string().min(1).max(64),
  department:  z.string().min(1).max(128),
  purpose:     z.string().min(3).max(500),
  sanctionRef: z.string().optional(),
  requiredBy:  z.string().optional(),
  items:       z.array(itemSchema).min(1),
});
export type CreateIndentBody = z.infer<typeof createIndentBody>;

export const approveIndentBody = z.object({
  notes: z.string().max(500).optional(),
});
export type ApproveIndentBody = z.infer<typeof approveIndentBody>;

export const indentQueryParams = z.object({ tenantId: z.string().uuid().optional() });
export const idParam = z.object({ id: z.string().uuid() });
