import { z } from "zod";

export const createRenewalBody = z.object({
  contractId: z.string().uuid(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  advanceNoticeDays: z.number().int().min(7).max(180).default(30),
});

export type CreateRenewalBody = z.infer<typeof createRenewalBody>;

export const updateRenewalBody = z.object({
  advanceNoticeDays: z.number().int().min(7).max(180).optional(),
  status: z.enum(["active", "renewed", "expired", "cancelled"]).optional(),
  version: z.number().int().min(1),
});

export type UpdateRenewalBody = z.infer<typeof updateRenewalBody>;

export const renewalIdParam = z.object({
  id: z.string().uuid(),
});

export const renewalListQuery = z.object({
  contractId: z.string().uuid().optional(),
  status: z.enum(["active", "renewed", "expired", "cancelled"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
