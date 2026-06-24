export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type TenderStatus =
  | "draft" | "published" | "technical_evaluation" | "financial_evaluation"
  | "awarded" | "cancelled";

// Allowed tender lifecycle transitions (GFR two-bid process).
const VALID_TRANSITIONS: Record<TenderStatus, TenderStatus[]> = {
  draft:                ["published", "cancelled"],
  published:            ["technical_evaluation", "cancelled"],
  technical_evaluation: ["financial_evaluation", "cancelled"],
  financial_evaluation: ["awarded", "cancelled"],
  awarded:              [],
  cancelled:            [],
};

export function assertTenderTransition(from: string, to: TenderStatus): void {
  const allowed = VALID_TRANSITIONS[from as TenderStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `tender cannot transition from '${from}' to '${to}'`);
  }
}

export interface L1Candidate {
  bidId: string;
  vendorId: string;
  amountMinor: bigint;
  /** technically qualified AND financial envelope opened */
  qualified: boolean;
  /** not blacklisted / disqualified */
  eligible: boolean;
  /** submission time — deterministic tie-break (earliest wins) */
  submittedAt?: Date | string | number;
}

function tieKey(c: L1Candidate): number {
  const t = c.submittedAt instanceof Date ? c.submittedAt.getTime()
    : c.submittedAt != null ? new Date(c.submittedAt).getTime() : Number.MAX_SAFE_INTEGER;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * L1 determination over qualified, non-blacklisted bidders. Lowest financial
 * amount wins; deterministic tie-break: equal amount → earliest submission →
 * lexicographically smallest bidId. Returns ranked list (rank 1 = L1). Bids that
 * are not qualified or not eligible are excluded entirely (never ranked).
 * Pure BigInt comparison — no Number() on paise.
 */
export function determineL1(candidates: L1Candidate[]): Array<{ bidId: string; vendorId: string; amountMinor: bigint; rank: number }> {
  const eligible = candidates
    .filter((c) => c.qualified && c.eligible)
    .sort((a, b) => {
      if (a.amountMinor !== b.amountMinor) return a.amountMinor < b.amountMinor ? -1 : 1;
      const ta = tieKey(a), tb = tieKey(b);
      if (ta !== tb) return ta - tb;
      return a.bidId < b.bidId ? -1 : a.bidId > b.bidId ? 1 : 0;
    });
  return eligible.map((c, i) => ({ bidId: c.bidId, vendorId: c.vendorId, amountMinor: c.amountMinor, rank: i + 1 }));
}

export function assertCanOpenFinancial(tenderStatus: string, technicalQualified: boolean | null): void {
  if (tenderStatus !== "financial_evaluation") {
    throw new DomainError("FINANCIAL_NOT_OPEN", `financial envelopes can only be opened in 'financial_evaluation' (tender is '${tenderStatus}')`);
  }
  if (technicalQualified !== true) {
    throw new DomainError("BID_NOT_QUALIFIED", "financial envelope cannot be opened for a bid that did not technically qualify");
  }
}
