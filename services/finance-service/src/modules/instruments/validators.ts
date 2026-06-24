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

export const listInstrumentsQuery = z.object({
  status: z.enum(["issued", "presented", "cleared", "bounced", "cancelled"]).optional(),
  type:   z.enum(["cheque", "dd"]).optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
});
export type ListInstrumentsQuery = z.infer<typeof listInstrumentsQuery>;

export const idParam = z.object({ id: z.string().uuid() });
