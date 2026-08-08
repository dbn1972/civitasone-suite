/**
 * Tender domain logic — authority routing, quotation comparison.
 */

export interface Quotation {
  contractorName: string;
  quotedAmountMinor: bigint;
  method: string;
}

/**
 * Determine the approving authority tier based on tender amount.
 */
export function resolveApprovingAuthority(tenderAmountMinor: bigint): string {
  if (tenderAmountMinor <= 500_000_00n) return "section_officer"; // up to 5 lakh
  if (tenderAmountMinor <= 25_00_000_00n) return "sdo";           // up to 25 lakh
  if (tenderAmountMinor <= 1_00_00_000_00n) return "do";          // up to 1 crore
  return "dao";                                                    // above 1 crore
}

/**
 * Compare quotations and find the lowest bidder (L1).
 */
export function findLowestBidder(quotations: Quotation[]): Quotation | null {
  if (quotations.length === 0) return null;
  return quotations.reduce((lowest, q) =>
    q.quotedAmountMinor < lowest.quotedAmountMinor ? q : lowest
  );
}

/**
 * Check if a pre-tender can be finalized.
 */
export function canFinalizePreTender(status: string): { allowed: boolean; reason?: string } {
  if (status !== "draft") {
    return { allowed: false, reason: `Cannot finalize: current status is '${status}', must be 'draft'` };
  }
  return { allowed: true };
}

/**
 * Two-level agreement finalization (BR: award must pass DAO then DO).
 * draft -> dao_finalized -> do_finalized.
 */
export function canDaoFinalizeAward(status: string): { allowed: boolean; reason?: string } {
  if (status !== "draft") {
    return { allowed: false, reason: `Cannot DAO-finalize: current status is '${status}', must be 'draft'` };
  }
  return { allowed: true };
}

export function canDoFinalizeAward(status: string): { allowed: boolean; reason?: string } {
  if (status !== "dao_finalized") {
    return { allowed: false, reason: `Cannot DO-finalize: current status is '${status}', must be 'dao_finalized'` };
  }
  return { allowed: true };
}

/** Roles that may read unredacted bid/quotation amounts (operators + approvers). */
const BID_DETAIL_ROLES = new Set([
  "works_admin", "works_operator", "super_admin", "dao", "do", "sdo",
]);

/**
 * Bid confidentiality: read-only viewers see redacted quotation fields.
 */
export function canViewBidDetails(roles: string[]): boolean {
  return roles.some((r) => BID_DETAIL_ROLES.has(r));
}

export interface QuotationRecord {
  id: string;
  contractorName: string;
  method: string;
  quotedAmountMinor: bigint | null;
  quotedPercentage: string | null;
  aboveOrBelowOrAtPar: string | null;
}

/** Mask sensitive bid fields when the caller lacks bid-detail roles. */
export function redactQuotation<T extends QuotationRecord>(q: T, showDetails: boolean): T {
  if (showDetails) return q;
  return {
    ...q,
    contractorName: "Bidder (confidential)",
    quotedAmountMinor: null,
    quotedPercentage: null,
    aboveOrBelowOrAtPar: null,
  };
}
