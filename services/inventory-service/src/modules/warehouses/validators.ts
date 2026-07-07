/**
 * warehouses module — zod request validators.
 */
import { z } from "zod";

export const createWarehouseBody = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(64),
  address: z.string().max(512).optional(),
});

export const updateWarehouseBody = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(64).optional(),
  address: z.string().max(512).nullable().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});

export const warehouseQueryParams = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idParam = z.object({
  id: z.string().uuid(),
});

export type CreateWarehouseInput = z.infer<typeof createWarehouseBody>;
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseBody>;
