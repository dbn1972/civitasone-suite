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
  // GAP-REVENUE-WRITE-OFFS-03: optional demand reference + its FY, so the
  // write-off records which year's demand it reduced. Optional for backward
  // compatibility; the UI supplies them when a demand is selected.
  demandId: z.string().uuid().optional(),
  financialYear: z.string().min(1).max(16).optional(),
  amountMinor: bigintStringCoerce,
  reason: z.string().min(1).max(500),
});

export const writeOffDecideBody = z.object({
  approve: z.boolean(),
  reason: z.string().optional(),
});

// GAP-REVENUE-WRITE-OFFS-02: query for the write-off list / checker queue.
export const listWriteOffsQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createRecoveryReferralBody = z.object({
  assesseeId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

/**
 * GAP-REVENUE-RECOVERY-02: query for the recovery register list — standard
 * pagination plus an optional assesseeId filter (coerced; a missing/blank
 * value lists all referrals for the tenant).
 */
export const recoveryReferralListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  assesseeId: z.string().uuid().optional(),
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
