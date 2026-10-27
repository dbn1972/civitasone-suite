import { z } from "zod";

export const createWarehouseBody = z.object({
  name:    z.string().min(1).max(256),
  code:    z.string().min(1).max(64),
  address: z.string().optional(),
});
export type CreateWarehouseBody = z.infer<typeof createWarehouseBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const warehouseQueryParams = z.object({
  q:          z.string().trim().min(1).max(100).optional(),
  activeOnly: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  limit:      z.coerce.number().int().positive().max(500).default(100),
  offset:     z.coerce.number().int().nonnegative().default(0),
});
