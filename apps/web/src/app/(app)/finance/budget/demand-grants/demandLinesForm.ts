import { rupeesToMinorString } from "@/lib/money";

/**
 * GAP-FINANCE-BUDGET-DEMAND-GRANTS-04: validation and request body for the head-wise split of a
 * demand (PUT /v1/finance/budgets/demand-grants/:id/lines). The split must total the demand
 * amount exactly; the server re-checks everything.
 */
export type LineDraft = { headCode: string; amount: string };

export type LinesCheck =
  | { ok: true; lines: Array<{ headCode: string; amountMinor: string }>; totalMinor: string }
  | { ok: false; reason: "empty" | "head" | "amount" | "duplicate" | "mismatch"; totalMinor: string };

export function checkLines(drafts: readonly LineDraft[], demandAmountMinor: string): LinesCheck {
  const lines: Array<{ headCode: string; amountMinor: string }> = [];
  const seen = new Set<string>();
  let total = 0n;
  let reason: Exclude<LinesCheck, { ok: true }>["reason"] | null = drafts.length === 0 ? "empty" : null;
  for (const d of drafts) {
    const head = d.headCode.trim();
    const minor = rupeesToMinorString(d.amount);
    if (!head) reason ??= "head";
    else if (minor === null) reason ??= "amount";
    else if (seen.has(head)) reason ??= "duplicate";
    else {
      seen.add(head);
      lines.push({ headCode: head, amountMinor: minor });
      total += BigInt(minor);
    }
  }
  if (reason === null && total !== BigInt(demandAmountMinor)) reason = "mismatch";
  return reason === null ? { ok: true, lines, totalMinor: total.toString() } : { ok: false, reason, totalMinor: total.toString() };
}
