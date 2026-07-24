import { z } from "zod";
import { bigintString } from "../../shared/validators.js";

export const createRateHeadBody = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  category: z.string().min(1).max(48),
  unitOfMeasure: z.string().optional(),
});

export const createRateSlabBody = z.object({
  rateHeadId: z.string().uuid(),
  slabType: z.enum(["flat", "ad_valorem", "band"]),
  bandFrom: bigintString.optional(),
  bandTo: bigintString.optional(),
  rateValue: bigintString,
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().optional(),
});

export const createPenaltyRuleBody = z.object({
  rateHeadId: z.string().uuid(),
  interestType: z.enum(["simple", "compound"]),
  annualRateBps: z.number().int().min(1).max(10000),
  graceDays: z.number().int().min(0).max(365),
  capMonths: z.number().int().min(1).max(120).optional(),
  roundingMode: z.enum(["floor", "ceil", "round_half_up"]),
});

export const createRebateRuleBody = z.object({
  rateHeadId: z.string().uuid(),
  rebateType: z.string(),
  discountBps: z.number().int().min(1).max(10000),
  validUntilDaysBeforeDue: z.number().int().min(0).max(365),
});
