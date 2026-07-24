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

export const createAdjustmentBody = z.object({
  assesseeId: z.string().uuid(),
  fromDemandId: z.string().uuid(),
  toDemandId: z.string().uuid(),
  amountMinor: bigintString,
  reason: z.string().min(1).max(500),
});
