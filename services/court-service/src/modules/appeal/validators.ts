import { z } from "zod";

export const appealIdParam = z.object({ id: z.string().uuid() });
export const caseIdParam = z.object({ id: z.string().uuid() });

/**
 * File an appeal against an original case's order (§25). `filedDate` is a calendar
 * date (YYYY-MM-DD). `appealType` defaults to 'appeal' when omitted.
 */
export const fileAppealBody = z.object({
  originalCaseId: z.string().uuid(),
  appealType:     z.enum(["appeal", "revision", "review"]).optional(),
  grounds:        z.string().trim().min(1).max(4000),
  filedDate:      z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "filedDate must be YYYY-MM-DD"),
});
export type FileAppealBody = z.infer<typeof fileAppealBody>;

/** Register a filed appeal (§25). `expectedVersion` is the optimistic-lock token. */
export const registerAppealBody = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});
export type RegisterAppealBody = z.infer<typeof registerAppealBody>;

/**
 * Decide a registered appeal (§25). `decision` is the terminal outcome and becomes
 * the appeal's status. `expectedVersion` is the optimistic-lock token.
 */
export const decideAppealBody = z.object({
  decision:        z.enum(["allowed", "dismissed", "remanded", "modified"]),
  decisionSummary: z.string().trim().min(1).max(4000),
  decidedDate:     z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "decidedDate must be YYYY-MM-DD"),
  expectedVersion: z.coerce.number().int().min(1),
});
export type DecideAppealBody = z.infer<typeof decideAppealBody>;

/** Withdraw a filed or registered appeal (§25). `expectedVersion` is the lock token. */
export const withdrawAppealBody = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});
export type WithdrawAppealBody = z.infer<typeof withdrawAppealBody>;
