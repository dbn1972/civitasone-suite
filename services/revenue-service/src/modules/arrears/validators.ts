import { z } from 'zod';
import { zMoneyMinorStringNonNeg } from '@civitasone/schemas';

// BUG FIX: was a hand-rolled union whose z.number() branch did
// `z.number().int().min(0)` with no Number.isSafeInteger guard -- an
// already-imprecise JSON literal above 2^53 (e.g. 9007199254740993, which
// JSON.parse silently rounds to 9007199254740992 before Zod ever sees it)
// still passes `.int()` and gets silently String()'d into the wrong amount.
// zMoneyMinorStringNonNeg is the canonical @civitasone/schemas money codec:
// same string|number union and non-negative bound, but rejects any unsafe
// (>2^53) number with a proper 400 instead of laundering it into a
// plausible-looking but wrong write-off/waiver amount. Same string output
// type as before, so downstream BigInt(amountMinor) call sites in
// arrears/consumer.ts are unaffected.
const bigintStringCoerce = zMoneyMinorStringNonNeg;

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
