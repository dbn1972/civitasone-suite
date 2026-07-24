import { z } from "zod";
import { bigintString } from "../../shared/validators.js";

export const createInstalmentBody = z.object({
  assesseeId: z.string().uuid(),
  instalmentCount: z.number().int().min(2).max(36),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
});

export const createWriteOffBody = z.object({
  assesseeId: z.string().uuid(),
  amountMinor: bigintString,
  reason: z.string().min(1).max(500),
});

export const writeOffDecideBody = z.object({
  approve: z.boolean(),
  reason: z.string().optional(),
});

export const createRecoveryReferralBody = z.object({
  assesseeId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});
