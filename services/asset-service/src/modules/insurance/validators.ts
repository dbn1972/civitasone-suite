import { z } from "zod";

export const policyBody = z.object({
  assetId:             z.string().uuid(),
  policyNo:            z.string().min(1).max(64),
  insurer:             z.string().min(1).max(256),
  coverageMinor:       z.number().int().nonnegative(),
  premiumMinor:        z.number().int().nonnegative(),
  currency:            z.string().length(3).default("INR"),
  startDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  renewalReminderDays: z.number().int().positive().default(30),
});
export type PolicyBody = z.infer<typeof policyBody>;

export const claimBody = z.object({
  policyId:        z.string().uuid(),
  assetId:         z.string().uuid(),
  claimDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  claimAmountMinor:z.number().int().nonnegative(),
  currency:        z.string().length(3).default("INR"),
  notes:           z.string().optional(),
});
export type ClaimBody = z.infer<typeof claimBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const policyQueryParams = z.object({
  assetId: z.string().uuid().optional(),
  status:  z.string().optional(),
  limit:   z.coerce.number().int().positive().max(200).default(50),
  offset:  z.coerce.number().int().nonnegative().default(0),
});

export const claimQueryParams = z.object({
  policyId: z.string().uuid().optional(),
  status:   z.string().optional(),
  limit:    z.coerce.number().int().positive().max(200).default(50),
  offset:   z.coerce.number().int().nonnegative().default(0),
});
