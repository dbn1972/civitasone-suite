import { z } from "zod";
import { zMoneyMinor } from "@civitasone/schemas/money";

const PG_BIGINT_MAX = 9223372036854775807n;
const moneyPositive = zMoneyMinor.pipe(z.bigint().positive("Amount must be greater than zero").max(PG_BIGINT_MAX, "Amount is too large"));

/** YYYY-MM-DD that is a real calendar date. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((d) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}, "Not a valid calendar date");

export const createGuaranteeBody = z.object({
  entity: z.string().trim().min(2, "Name the guaranteed entity").max(200),
  type: z.enum(["bg", "pbg", "performance", "advance"]),
  amountMinor: moneyPositive,
  // percentage, e.g. "1.25"; column is numeric(5,4)
  feePct: z.string().regex(/^\d(\.\d{1,4})?$/, "Fee must be a percentage below 10, e.g. 1.25").default("0"),
  validUntil: isoDate,
  beneficiary: z.string().trim().min(2, "Name the beneficiary").max(200),
  linkedRef: z.string().trim().max(200).optional(),
});
export type CreateGuaranteeBody = z.infer<typeof createGuaranteeBody>;

export const createDebtBody = z.object({
  instrument: z.string().trim().min(2).max(200),
  source: z.string().trim().min(2).max(64),
  lender: z.string().trim().min(2, "Name the lender").max(200),
  principalMinor: moneyPositive,
  interestRateBps: z.number().int().min(0).max(10_000),
  tenureMonths: z.number().int().min(1).max(600),
  firstEmiDate: isoDate,
  currency: z.string().length(3).default("INR"),
});
export type CreateDebtBody = z.infer<typeof createDebtBody>;

export const payEmiBody = z.object({
  paidOn: isoDate.optional(),
  paymentRef: z.string().trim().max(128).optional(),
  /** Pay from a different bank head than the tenant default (an office with several accounts). */
  bankHeadId: z.string().uuid().optional(),
});
export const emiParams = z.object({ id: z.string().uuid(), no: z.coerce.number().int().min(1).max(600) });
