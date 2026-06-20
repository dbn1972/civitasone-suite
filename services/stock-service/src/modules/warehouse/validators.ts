import { z } from "zod";

export const createWarehouseBody = z.object({
  name:    z.string().min(1).max(256),
  code:    z.string().min(1).max(64),
  address: z.string().optional(),
});
export type CreateWarehouseBody = z.infer<typeof createWarehouseBody>;

export const idParam = z.object({ id: z.string().uuid() });
