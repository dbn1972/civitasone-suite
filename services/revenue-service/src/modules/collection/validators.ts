import { z } from "zod";
import { bigintString } from "../../shared/validators.js";

export const createReceiptBody = z.object({
  assesseeId: z.string().uuid(),
  demandId: z.string().uuid(),
  amountMinor: bigintString,
  channel: z.string().min(1),
  reference: z.string().min(1),
  instrumentNo: z.string().optional(),
  bankName: z.string().optional(),
});

export const createRefundBody = z.object({
  receiptId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export const refundDecideBody = z.object({
  approve: z.boolean(),
  reason: z.string().optional(),
});

/**
 * GAP-REVENUE-REFUNDS-01: query for the refund register list — pagination plus
 * an optional status filter (e.g. ?status=pending). Status is constrained to
 * the real collection.refunds enum so a typo can't silently return nothing.
 */
export const refundListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["pending", "approved", "rejected", "processed"]).optional(),
});

export const createBatchReceiptBody = z.object({
  assesseeId: z.string().uuid(),
  demandIds: z.array(z.string().uuid()).min(1).max(20),
  amountMinor: bigintString,
  channel: z.string().min(1),
  reference: z.string().min(1),
  instrumentNo: z.string().optional(),
  bankName: z.string().optional(),
});

export const createAdjustmentBody = z.object({
  assesseeId: z.string().uuid(),
  fromDemandId: z.string().uuid(),
  toDemandId: z.string().uuid(),
  amountMinor: bigintString,
  reason: z.string().min(1).max(500),
});

/**
 * GAP-REVENUE-ADJUSTMENTS-01: a checker approves or rejects a pending balance
 * transfer. Mirrors refundDecideBody — the server enforces maker!=checker.
 */
export const adjustmentDecideBody = z.object({
  approve: z.boolean(),
  reason: z.string().max(500).optional(),
});

/**
 * GAP-REVENUE-ADJUSTMENTS-01: query for the adjustment approval queue —
 * pagination plus an optional status filter (e.g. ?status=pending so a checker
 * can find transfers awaiting approval without being handed a UUID). Status is
 * constrained to the collection.adjustments lifecycle so a typo can't silently
 * return nothing.
 */
export const adjustmentListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});
