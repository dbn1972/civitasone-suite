export const DEPOSIT_DECISIONS = ["full_refund", "partial_refund", "forfeited"] as const;
export type DepositDecision = (typeof DEPOSIT_DECISIONS)[number];

export function canDecideDeposit(inspection: { depositDecision: string | null }): boolean {
  return inspection.depositDecision === null;
}
