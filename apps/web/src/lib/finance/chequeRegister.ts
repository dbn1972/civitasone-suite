/**
 * Pure helpers for the cheque / DD register (GAP-FINANCE-TREASURY-CHEQUES-04/05).
 */
export interface ChequeStatusCounts {
  total: number;
  issued: number;
  presented: number;
  cleared: number;
  bounced: number;
  cancelled: number;
  /** Any status outside the known lifecycle, so the cards always sum to total. */
  other: number;
}

/** treasury.finance_instruments lifecycle: issued -> presented -> cleared | bounced | cancelled. */
export function chequeStatusCounts(rows: ReadonlyArray<{ status?: unknown }>): ChequeStatusCounts {
  const c: ChequeStatusCounts = { total: rows.length, issued: 0, presented: 0, cleared: 0, bounced: 0, cancelled: 0, other: 0 };
  for (const r of rows) {
    const s = String(r.status ?? "").trim().toLowerCase();
    if (s === "issued") c.issued += 1;
    else if (s === "presented") c.presented += 1;
    else if (s === "cleared") c.cleared += 1;
    else if (s === "bounced") c.bounced += 1;
    else if (s === "cancelled") c.cancelled += 1;
    else c.other += 1;
  }
  return c;
}

/** "HDFC Bank \u2022\u2022\u2022\u2022 1234": bank plus the last four digits only, never the full number. */
export function drawnOnLabel(bankName: string | null | undefined, last4: string | null | undefined): string {
  const bank = (bankName ?? "").trim();
  const tail = (last4 ?? "").replace(/\D/g, "").slice(-4);
  if (!tail) return bank;
  return bank ? `${bank} \u2022\u2022\u2022\u2022 ${tail}` : `\u2022\u2022\u2022\u2022 ${tail}`;
}
