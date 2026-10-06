/**
 * Pure helpers for the Establishment Approval Matrix.
 *
 * GAP-ESTAB-APPROVAL-MATRIX-04: human labels for the raw module-action source
 * codes (finance_sanction → "Finance: Sanction"), so group headings and the
 * action <select> never show snake_case to an admin. The raw code is kept as
 * the option value and shown as quiet secondary text.
 *
 * GAP-ESTAB-APPROVAL-MATRIX-03: validateBands flags overlapping or gapped
 * amount bands for the same sourceType among active rules, so a typo'd chain
 * or a hole in the matrix is caught client-side (the server remains the
 * authority). Bands follow the resolver convention: min inclusive, max
 * exclusive, max === null means open-ended (∞).
 */

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  finance_sanction: "Finance: Sanction",
  finance_payment: "Finance: Payment",
  finance_reappropriation: "Finance: Re-appropriation",
  procurement_award: "Procurement: Award",
  procurement_po: "Procurement: Purchase Order",
  hr_promotion: "HR: Promotion",
  hr_transfer: "HR: Transfer",
  hr_disciplinary: "HR: Disciplinary Action",
  hr_leave_special: "HR: Special Leave",
  hr_recruitment: "HR: Recruitment",
  grant_scheme: "Grant: Scheme Sanction",
  grant_disbursement: "Grant: Disbursement",
  asset_disposal: "Asset: Disposal",
  legal_opinion: "Legal: Opinion",
  contract_award: "Contract: Award",
};

/** Human label for a source-type code; falls back to a de-underscored title case. */
export function labelForSourceType(code: string): string {
  return (
    SOURCE_TYPE_LABEL[code] ??
    code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export interface BandInput {
  minAmountMinor: number;
  maxAmountMinor: number | null;
}

export interface BandIssue {
  kind: "overlap" | "gap";
  message: string;
}

const MAX = Number.MAX_SAFE_INTEGER;

/**
 * Check a candidate band against the existing ACTIVE bands of the same
 * sourceType. Returns the issues found:
 *  - "overlap": the candidate's [min,max) intersects an existing band — this
 *    is a hard error (two chains would claim the same amount).
 *  - "gap": sorting all bands (existing + candidate) by min leaves a hole
 *    between the end of one band and the start of the next — a warning (some
 *    amounts route to no chain).
 *
 * Callers block submit on an overlap and surface gaps as a non-blocking
 * warning. Pure and side-effect free so it is unit-testable.
 */
export function validateBands(existing: BandInput[], candidate: BandInput): BandIssue[] {
  const issues: BandIssue[] = [];
  const candMax = candidate.maxAmountMinor ?? MAX;

  for (const band of existing) {
    const bandMax = band.maxAmountMinor ?? MAX;
    // Half-open intervals [min, max): they overlap iff each starts before the
    // other ends.
    const overlaps = candidate.minAmountMinor < bandMax && band.minAmountMinor < candMax;
    if (overlaps) {
      issues.push({
        kind: "overlap",
        message: `This band overlaps an existing rule (${fmt(band.minAmountMinor)}–${fmt(band.maxAmountMinor)}). Bands for one action must not overlap.`,
      });
    }
  }

  // Gap detection across the merged, sorted set (only meaningful when there is
  // at least one other band and no overlap muddies the picture).
  if (issues.length === 0 && existing.length > 0) {
    const all = [...existing, candidate]
      .map((b) => ({ min: b.minAmountMinor, max: b.maxAmountMinor ?? MAX }))
      .sort((a, b) => a.min - b.min);
    for (let i = 1; i < all.length; i++) {
      if (all[i]!.min > all[i - 1]!.max) {
        issues.push({
          kind: "gap",
          message: `There is a gap between ${fmt(all[i - 1]!.max)} and ${fmt(all[i]!.min)} where no approval rule applies.`,
        });
        break;
      }
    }
  }

  return issues;
}

function fmt(minor: number | null): string {
  if (minor === null || minor === MAX) return "∞";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

/** A role token the matrix accepts: lowercase identifier, used as a workflow role. */
export const ROLE_TOKEN_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** Parse a comma-separated approver list; returns null if any token is invalid or empty. */
export function parseRoleTokens(csv: string): string[] | null {
  const tokens = csv.split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  for (const t of tokens) {
    if (!ROLE_TOKEN_RE.test(t)) return null;
  }
  return tokens;
}
