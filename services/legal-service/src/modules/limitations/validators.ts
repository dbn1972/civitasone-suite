import { z } from "zod";

export const createLimitationBody = z.object({
  matterId:   z.string().uuid(),
  ruleType:   z.string().min(1).max(64),
  startDate:  z.string().datetime(),
  periodDays: z.number().int().min(1).max(36500),
});
export type CreateLimitationBody = z.infer<typeof createLimitationBody>;

export const updateLimitationBody = z.object({
  ruleType:   z.string().min(1).max(64).optional(),
  startDate:  z.string().datetime().optional(),
  periodDays: z.number().int().min(1).max(36500).optional(),
  status:     z.enum(["active", "expired", "cancelled"]).optional(),
});
export type UpdateLimitationBody = z.infer<typeof updateLimitationBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const listLimitationsQuery = z.object({
  matterId: z.string().uuid().optional(),
  status:   z.enum(["active", "expired", "cancelled"]).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListLimitationsQuery = z.infer<typeof listLimitationsQuery>;
