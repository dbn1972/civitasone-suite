/** zod validators — applied at the route boundary for cycle count operations. */
import { z } from "zod";

export const cycleCountStatus = z.enum(["pending", "auto_posted", "pending_approval", "approved", "rejected"]);

export const createCycleCountBody = z.object({
  itemId:       z.string().uuid(),
  warehouseId:  z.string().uuid(),
  physicalQty:  z.number().int().nonnegative().max(10_000_000),
  reasonCode:   z.string().min(1).max(64),
  countedAt:    z.string().datetime().optional(),
});
export type CreateCycleCountBody = z.infer<typeof createCycleCountBody>;

export const approveCycleCountBody = z.object({
  version: z.number().int().positive(),
});
export type ApproveCycleCountBody = z.infer<typeof approveCycleCountBody>;

export const rejectCycleCountBody = z.object({
  version: z.number().int().positive(),
  reason:  z.string().min(1).max(500),
});
export type RejectCycleCountBody = z.infer<typeof rejectCycleCountBody>;

export const cycleCountQueryParams = z.object({
  itemId:      z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status:      z.string().max(32).optional(),
  limit:       z.coerce.number().int().positive().max(200).default(50),
  offset:      z.coerce.number().int().nonnegative().default(0),
});

export const idParam = z.object({ id: z.string().uuid() });
