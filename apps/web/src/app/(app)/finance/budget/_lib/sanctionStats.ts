/**
 * GAP-FINANCE-BUDGET-SANCTIONS-03 / -05: the sanctions headline numbers and the
 * ONE status vocabulary shared by the tab, the stat card and the pill.
 */
export const SANCTION_STATUS_LABEL = {
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
} as const;

export type SanctionStats = {
  /** Sanctions that are still live: approved or awaiting approval (rejected ones are not). */
  active: number;
  approved: number;
  pending: number;
  /** Sum of APPROVED sanction amounts only (paise). Pending/rejected money is not "sanctioned". */
  approvedMinor: bigint;
  /** Sum of amounts still awaiting approval (paise). */
  pendingMinor: bigint;
};

function toMinor(amount: unknown): bigint {
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") return Number.isSafeInteger(amount) ? BigInt(amount) : 0n;
  if (typeof amount === "string" && /^[+-]?\d+$/.test(amount.trim())) return BigInt(amount.trim());
  return 0n;
}

export function summariseSanctions(rows: ReadonlyArray<{ status: string; amount: unknown }>): SanctionStats {
  const s: SanctionStats = { active: 0, approved: 0, pending: 0, approvedMinor: 0n, pendingMinor: 0n };
  for (const r of rows) {
    if (r.status === "approved") {
      s.approved += 1;
      s.approvedMinor += toMinor(r.amount);
    } else if (r.status === "pending") {
      s.pending += 1;
      s.pendingMinor += toMinor(r.amount);
    }
  }
  s.active = s.approved + s.pending;
  return s;
}
