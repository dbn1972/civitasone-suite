import { z } from "zod";
import { zMoneyMinor as zMoneyMinorBase } from "@civitasone/schemas/money";

// FIX: was a hand-rolled union missing a z.number() branch, so a plain
// JSON-number debitMinor/creditMinor (the common case) 400'd. zMoneyMinorBase
// is the canonical @civitasone/schemas/money decoder — accepts
// string | safe-integer number | bigint.
const zMoneyMinor = zMoneyMinorBase.pipe(z.bigint().nonnegative());

const journalLine = z.object({
  accountCode: z.string().min(1),
  debitMinor:  zMoneyMinor,
  creditMinor: zMoneyMinor,
});

export const postJournalBody = z.object({
  // Pass "AUTO" (or omit) to allocate a gapless, FY-sequential voucher number.
  voucherNo:   z.string().min(1).max(64).default("AUTO"),
  type:        z.enum(["journal", "payment", "receipt", "contra"]),
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "postingDate must be YYYY-MM-DD"),
  lines:       z.array(journalLine).min(2),
  // DOM-007: explicit override of the per-head budget check in gl/consumer.ts.
  // Setting this true requires BUDGET_OVERRIDE_ROLES (gl/routes.ts) — a plain
  // finance_officer cannot post over budget even by sending this flag.
  budgetOverride: z.boolean().default(false),
  overrideReason: z.string().min(1).max(500).optional(),
}).refine(
  (b) => {
    const td = b.lines.reduce((s, l) => s + l.debitMinor,  0n);
    const tc = b.lines.reduce((s, l) => s + l.creditMinor, 0n);
    return td === tc;
  },
  { message: "journal lines must balance: sum(debit) must equal sum(credit)" }
).refine(
  (b) => !b.budgetOverride || (b.overrideReason && b.overrideReason.trim().length > 0),
  { message: "overrideReason is required when budgetOverride is true", path: ["overrideReason"] }
);
export type PostJournalBody = z.infer<typeof postJournalBody>;

export const ledgerQueryParams = z.object({
  headId: z.string().optional(),   // UUID or 4-digit account code; omit for all recent entries
  from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
});
export type LedgerQueryParams = z.infer<typeof ledgerQueryParams>;

export const reverseParam = z.object({
  id: z.string().uuid(),
});
export type ReverseParam = z.infer<typeof reverseParam>;
