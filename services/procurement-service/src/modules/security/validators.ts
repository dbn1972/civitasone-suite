import { z } from "zod";

export const collectEmdBody = z.object({
  vendorId:    z.string().uuid(),
  tenderId:    z.string().uuid().optional(),
  bidId:       z.string().uuid().optional(),
  amountMinor: z.number().int().positive(),
  instrument:  z.enum(["bank_guarantee", "dd", "online"]).default("bank_guarantee"),
});
export type CollectEmdBody = z.infer<typeof collectEmdBody>;

export const resolveEmdBody = z.object({
  reason: z.string().max(1000).optional(),
});
export type ResolveEmdBody = z.infer<typeof resolveEmdBody>;

export const collectPbgBody = z.object({
  vendorId:    z.string().uuid(),
  poRef:       z.string().min(1).optional(),
  tenderId:    z.string().uuid().optional(),
  amountMinor: z.number().int().positive(),
  instrument:  z.enum(["bank_guarantee", "dd", "online"]).default("bank_guarantee"),
  validUntil:  z.string().optional(),
});
export type CollectPbgBody = z.infer<typeof collectPbgBody>;

export const resolvePbgBody = z.object({
  reason: z.string().max(1000).optional(),
});
export type ResolvePbgBody = z.infer<typeof resolvePbgBody>;

export const idParam = z.object({ id: z.string().uuid() });
