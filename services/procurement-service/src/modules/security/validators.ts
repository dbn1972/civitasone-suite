import { z } from "zod";

export const collectEmdBody = z.object({
  vendorId:    z.string().uuid(),
  tenderId:    z.string().uuid().optional(),
  bidId:       z.string().uuid().optional(),
  amountMinor: z.number().int().positive(),
  instrument:  z.enum(["bank_guarantee", "dd", "online"]).default("bank_guarantee"),
});
export type CollectEmdBody = z.infer<typeof collectEmdBody>;

/**
 * D4c #26 (GAP-PROCUREMENT-EMD-BG-06): the treasury / PFMS payment reference
 * (UTR) is mandatory on a refund or release, and the forfeiture order number is
 * mandatory on a forfeit. Both are free text (trimmed, 3-64 chars).
 */
const paymentRef = z.string().trim().min(3, "payment reference (UTR / PFMS) is required").max(64);
const forfeitureOrderNo = z.string().trim().min(1, "forfeiture order number is required").max(64);

export const refundEmdBody = z.object({
  reason: z.string().max(1000).optional(),
  paymentRef,
});
export type RefundEmdBody = z.infer<typeof refundEmdBody>;

export const forfeitEmdBody = z.object({
  reason: z.string().max(1000).optional(),
  forfeitureOrderNo,
});
export type ForfeitEmdBody = z.infer<typeof forfeitEmdBody>;

export const collectPbgBody = z.object({
  vendorId:    z.string().uuid(),
  poRef:       z.string().min(1).optional(),
  tenderId:    z.string().uuid().optional(),
  amountMinor: z.number().int().positive(),
  instrument:  z.enum(["bank_guarantee", "dd", "online"]).default("bank_guarantee"),
  validUntil:  z.string().optional(),
});
export type CollectPbgBody = z.infer<typeof collectPbgBody>;

export const releasePbgBody = z.object({
  reason: z.string().max(1000).optional(),
  paymentRef,
});
export type ReleasePbgBody = z.infer<typeof releasePbgBody>;

export const forfeitPbgBody = z.object({
  reason: z.string().max(1000).optional(),
  forfeitureOrderNo,
});
export type ForfeitPbgBody = z.infer<typeof forfeitPbgBody>;

export const idParam = z.object({ id: z.string().uuid() });
