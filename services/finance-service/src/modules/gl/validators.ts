import { z } from "zod";
import { zMoneyMinor as zMoneyMinorBase } from "@civitasone/schemas/money";
import { zIsoDate, zTrimmedCode, DATE_WINDOWS, istToday, yearsFromEnv, boundedMinorBigint } from "@civitasone/schemas/validators";

/**
 * UAT T-EDGE TE-01 / TE-07: journal posting-date window -- from the start of the financial year
 * FINANCE_POSTING_PAST_FYS (default 1) before the current one to the end of the one
 * FINANCE_POSTING_FUTURE_FYS (default 1) after it. 1990 / 2099 drafts used to be accepted.
 */
export const postingDateWindow = () => DATE_WINDOWS.transaction(
  istToday(), yearsFromEnv("FINANCE_POSTING_PAST_FYS", 1), yearsFromEnv("FINANCE_POSTING_FUTURE_FYS", 1),
);

// FIX: was a hand-rolled union missing a z.number() branch, so a plain
// JSON-number debitMinor/creditMinor (the common case) 400'd. zMoneyMinorBase
// is the canonical @civitasone/schemas/money decoder — accepts
// string | safe-integer number | bigint.
// UAT T-EDGE TE-07 (J11): bounded to the sane maximum (1e20 paise used to become a draft).
const zMoneyMinor = zMoneyMinorBase.pipe(z.bigint().nonnegative().superRefine(boundedMinorBigint));

// A NUL (U+0000) byte is not storable in a Postgres text column: it reaches the
// duplicate-voucher / control-account lookups in gl/routes.ts as a driver error and
// surfaced as a 500. It is never legitimate input, so refuse it at the boundary (400).
const noNul = (v: string) => !v.includes("\u0000");
const NO_NUL_MESSAGE = "must not contain NUL (\\u0000) characters";

// UAT P2 (J6, D10): the narration typed on the voucher form. It was not part of this schema, so zod stripped it and
// the stored journal had none. Optional per line and for the whole voucher; commands.ts copies the voucher
// narration onto each line that has none (lines are the jsonb the ledger, search and approver read it from).
// A blank narration is "none" (it used to be silently dropped too), not a 400.
const narrationField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().max(500).refine(noNul, NO_NUL_MESSAGE).optional(),
);

const journalLine = z.object({
  // UAT T-EDGE TE-06 (J17): trimmed before it is stored or looked up.
  accountCode: zTrimmedCode(64, "account code").refine(noNul, NO_NUL_MESSAGE),
  debitMinor:  zMoneyMinor,
  creditMinor: zMoneyMinor,
  narration:   narrationField,
}).refine(
  (l) => !(l.debitMinor > 0n && l.creditMinor > 0n),
  // LOWER-PRIORITY FIX (accounting-critical, related): a single line with
  // both debit and credit positive is not a valid double-entry line (it
  // nets to a smaller one-sided movement while reporting inflated gross
  // debit/credit totals) and was previously rejected only in the frontend
  // form, with no server-side/schema-level enforcement — any direct API
  // caller could post one. Enforced here, at the schema boundary, for every
  // caller.
  { message: "a journal line cannot have both debit and credit positive simultaneously", path: ["creditMinor"] },
).refine(
  // B22 D6: a line must move money on one side; 0/0 lines were stored on posted vouchers (CONTRA/2026-27/000010-13).
  (l) => l.debitMinor > 0n || l.creditMinor > 0n,
  { message: "a journal line must have a debit or a credit amount greater than zero", path: ["debitMinor"] },
);

export const postJournalBody = z.object({
  // Pass "AUTO" (or omit) to allocate a gapless, FY-sequential voucher number.
  voucherNo:   z.string().min(1).max(64).refine(noNul, NO_NUL_MESSAGE).default("AUTO"),
  type:        z.enum(["journal", "payment", "receipt", "contra"]),
  postingDate: zIsoDate({ window: postingDateWindow, label: "posting date" }),
  lines:       z.array(journalLine).min(2),
  narration:   narrationField,
  // DOM-007: explicit override of the per-head budget check in gl/consumer.ts.
  // Setting this true requires BUDGET_OVERRIDE_ROLES (gl/routes.ts) — a plain
  // finance_officer cannot post over budget even by sending this flag.
  budgetOverride: z.boolean().default(false),
  overrideReason: z.string().min(1).max(500).refine(noNul, NO_NUL_MESSAGE).optional(),
}).refine(
  (b) => {
    const td = b.lines.reduce((s, l) => s + l.debitMinor,  0n);
    const tc = b.lines.reduce((s, l) => s + l.creditMinor, 0n);
    return td === tc;
  },
  { message: "journal lines must balance: sum(debit) must equal sum(credit)" }
).refine(
  // A balanced 0/0 journal has nothing to post. Without this, a maker could
  // create a zero-amount draft (the balance check above passes trivially at
  // 0 === 0) and a checker's later approval of it would silently no-op deep
  // inside gl/consumer.ts's postJournal() — 202 accepted, journal stuck in
  // pending_approval forever, no visible failure anywhere. See
  // assertJournalHasAmount()'s doc comment (gl/domain.ts).
  (b) => b.lines.reduce((s, l) => s + l.debitMinor, 0n) > 0n,
  {
    message: "journal must have a nonzero amount: a balanced 0/0 entry has nothing to post",
    path: ["lines"],
  }
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

/** UAT P2 (J6): a rejection is final, so the checker must say why (min 10 characters). */
export const rejectJournalBody = z.object({
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters").max(500).refine(noNul, NO_NUL_MESSAGE),
});
export type RejectJournalBody = z.infer<typeof rejectJournalBody>;

export const reverseParam = z.object({
  id: z.string().uuid(),
});
export type ReverseParam = z.infer<typeof reverseParam>;

/** GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03: filters + bounded paging for the ledger page. */
export const ledgerPageQuery = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/, "fy must be a fiscal year such as 2026-27")
    .refine((v) => Number(v.slice(5)) === (Number(v.slice(0, 4)) + 1) % 100, "fy must be consecutive years such as 2026-27").optional(),
  type: z.enum(["journal", "payment", "receipt", "contra", "budget"]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
});
export type LedgerPageQuery = z.infer<typeof ledgerPageQuery>;
