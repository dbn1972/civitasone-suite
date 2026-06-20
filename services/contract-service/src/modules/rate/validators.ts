import { z } from "zod";

const rcItemSchema = z.object({
  itemCode:       z.string().min(1).max(64),
  description:    z.string().min(1).max(500),
  unit:           z.string().min(1).max(32).default("nos"),
  unitPriceMinor: z.number().int().nonnegative(),
  currency:       z.string().length(3).default("INR"),
});

export const createRcBody = z.object({
  rcNo:       z.string().min(1).max(64),
  vendorId:   z.string().uuid(),
  title:      z.string().min(1).max(256),
  validFrom:  z.string(),
  validUntil: z.string(),
  items:      z.array(rcItemSchema).min(1),
});
export type CreateRcBody = z.infer<typeof createRcBody>;

export const rcQueryParams = z.object({
  item:     z.string().optional(),
  tenantId: z.string().uuid().optional(),
});

export const idParam = z.object({ id: z.string().uuid() });
