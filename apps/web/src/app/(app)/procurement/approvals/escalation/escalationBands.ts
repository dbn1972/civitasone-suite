import { formatMoney } from "@/lib/formatters";

/**
 * GAP-PROCUREMENT-APPROVALS-ESCALATION-02: model the delegation-of-financial-
 * powers bands as NUMERIC half-open paise ranges [minPaise, maxPaise) so they
 * can be compared, tested for contiguity/non-overlap, and rendered with
 * formatMoney — rather than free-text strings where a boundary value (e.g.
 * ₹1,00,000) appeared in two bands at once. `maxPaise: null` means "and above".
 *
 * NOTE (HUMAN REVIEW — authz/money): these authority thresholds are the
 * delegation-of-financial-powers routing. The authoritative routing lives in
 * the workflow-service, which is NOT present in this worktree
 * (GAP-PROCUREMENT-APPROVALS-ESCALATION-01), so this remains a developer-
 * maintained reference table, not a backend load. Confirm the real GFR /
 * tenant delegation thresholds before relying on it operationally.
 */
export interface EscalationBand {
  /** Inclusive lower bound in paise. */
  minPaise: number;
  /** Exclusive upper bound in paise, or null for "and above". */
  maxPaise: number | null;
  approvingAuthority: string;
  escalatesAfterDays: number;
}

const LAKH = 100_000; // rupees
const RUPEE = 100; // paise per rupee

export const ESCALATION_BANDS: EscalationBand[] = [
  // Up to and including ₹1,00,000  ->  [0, 1,00,000 + 1 paise)
  { minPaise: 0, maxPaise: 1 * LAKH * RUPEE + 1, approvingAuthority: "Procurement Officer", escalatesAfterDays: 2 },
  // Over ₹1,00,000 up to and including ₹10,00,000
  { minPaise: 1 * LAKH * RUPEE + 1, maxPaise: 10 * LAKH * RUPEE + 1, approvingAuthority: "Procurement Admin", escalatesAfterDays: 3 },
  // Over ₹10,00,000
  { minPaise: 10 * LAKH * RUPEE + 1, maxPaise: null, approvingAuthority: "Procurement Admin + Finance", escalatesAfterDays: 5 },
];

/**
 * Human label for a band, generated from the numeric bounds via formatMoney so
 * no boundary value ever appears in two bands. The first band reads "… and
 * below"; middle bands read "Over X up to Y"; the open-ended band reads
 * "Over X".
 */
export function bandLabel(band: EscalationBand, index: number): string {
  if (index === 0 && band.maxPaise !== null) {
    // Inclusive upper bound = maxPaise - 1 (the band is half-open).
    return `${formatMoney(band.maxPaise - 1)} and below`;
  }
  const over = formatMoney(band.minPaise - 1);
  if (band.maxPaise === null) return `Over ${over}`;
  return `Over ${over} up to ${formatMoney(band.maxPaise - 1)}`;
}

/** Which band a given paise amount falls into (half-open ranges). */
export function bandForAmount(paise: number): EscalationBand | undefined {
  return ESCALATION_BANDS.find(
    (b) => paise >= b.minPaise && (b.maxPaise === null || paise < b.maxPaise),
  );
}
