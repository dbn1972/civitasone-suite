import { z } from 'zod';

const bigintStringCoerce = z.union([
  z.string().regex(/^\d+$/, 'must be a non-negative integer string'),
  z.number().int().min(0).transform((n: number) => String(n)),
]);

export const createInstalmentBody = z.object({
  assesseeId: z.string().uuid(),
  instalmentCount: z.number().int().min(2).max(36),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
});

export const createWriteOffBody = z.object({
  assesseeId: z.string().uuid(),
  amountMinor: bigintStringCoerce,
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

export const createWaiverBody = z.object({
  assesseeId:  z.string().uuid().optional(),
  demandId:    z.string().uuid(),
  waiverType:  z.enum(['penalty', 'interest', 'both']).optional().default('both'),
  amountMinor: bigintStringCoerce,
  reason:      z.string().min(1).max(500),
});

export const waiverDecideBody = z.object({
  approvalId: z.string().uuid().optional(),
  approve:    z.boolean(),
  reason:     z.string().max(500).optional(),
});
