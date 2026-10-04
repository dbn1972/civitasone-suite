import { z } from "zod";

export const issueInstrumentBody = z.object({
  instrumentType: z.enum(["cheque", "dd"]),
  instrumentNo:   z.string().min(1).max(64),
  bankName:       z.string().min(1).max(200),
  payee:          z.string().min(1).max(200),
  amountMinor:    z.number().int().positive(),
  currency:       z.string().length(3).default("INR"),
  issueDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bankAccountId:  z.string().uuid().optional(),
  paymentId:      z.string().uuid().optional(),
});
export type IssueInstrumentBody = z.infer<typeof issueInstrumentBody>;

/** present / clear take no body fields; bounce carries an optional reason. */
export const bounceInstrumentBody = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type BounceInstrumentBody = z.infer<typeof bounceInstrumentBody>;

/** Cancelling / re-presenting a cheque needs a reason on the record (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04). */
export const reasonedInstrumentBody = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type ReasonedInstrumentBody = z.infer<typeof reasonedInstrumentBody>;

/** Mark-stale takes an optional note. */
export const staleInstrumentBody = z.object({
  reason: z.string().trim().min(5).max(500).optional(),
});

/** Audited reveal of the drawn-on account number. */
export const revealAccountBody = z.object({
  reason: z.string().trim().min(5).max(300),
});

export const listInstrumentsQuery = z.object({
  status: z.enum(["issued", "presented", "cleared", "bounced", "cancelled", "stale"]).optional(),
  type:   z.enum(["cheque", "dd"]).optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
});
export type ListInstrumentsQuery = z.infer<typeof listInstrumentsQuery>;

export const idParam = z.object({ id: z.string().uuid() });
