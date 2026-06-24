/**
 * GFR 2017 procurement-mode value bands.
 *
 * Selects / validates the permissible procurement mode(s) for a given estimated
 * value (PAISE, bigint). Thresholds follow General Financial Rules 2017:
 *   - Rule 154: purchase WITHOUT quotation (direct purchase) up to Rs 25,000.
 *   - Rule 155: purchase by purchase-committee / GeM up to Rs 2,50,000.
 *   - Rule 162: limited tender enquiry up to Rs 50,00,000.
 *   - Rule 161: advertised (open) tender above Rs 50,00,000.
 *   - Rule 166: single-tender / proprietary — an EXCEPTION, permitted at any
 *     value only with recorded justification.
 *   - GeM (Rule 149) is permissible at every value band.
 *
 * Money is paise. Boundaries are INCLUSIVE of the upper rupee figure.
 */
export class GfrModeError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "GfrModeError";
  }
}

/** Canonical procurement modes recognised by the band engine. */
export type ProcurementMode =
  | "direct_purchase"
  | "gem"
  | "limited_tender"
  | "advertised_tender"
  | "single_tender";

// Band ceilings in PAISE (inclusive upper bound of each rupee figure).
export const DIRECT_PURCHASE_CEILING_MINOR = 2_500_000n;     // Rs    25,000
export const COMMITTEE_GEM_CEILING_MINOR = 25_000_000n;      // Rs 2,50,000
export const LIMITED_TENDER_CEILING_MINOR = 500_000_000n;    // Rs 50,00,000
// Above LIMITED_TENDER_CEILING_MINOR -> advertised (open) tender.

/**
 * Modes that are always permissible at any value (with their own GFR controls):
 *   - gem            : Rule 149 — GeM is allowed across all bands.
 *   - single_tender  : Rule 166 — proprietary / single-source, justification-gated.
 */
const ALWAYS_ALLOWED: ProcurementMode[] = ["gem", "single_tender"];

/**
 * Returns the set of GFR-permissible modes for an estimated value (paise):
 * the value-band mode (direct/limited/advertised) plus the always-allowed
 * exception modes (gem, single_tender).
 */
export function allowedModesForValue(estimatedMinor: bigint): ProcurementMode[] {
  let bandMode: ProcurementMode;
  if (estimatedMinor <= DIRECT_PURCHASE_CEILING_MINOR) {
    bandMode = "direct_purchase";
  } else if (estimatedMinor <= LIMITED_TENDER_CEILING_MINOR) {
    bandMode = "limited_tender";
  } else {
    bandMode = "advertised_tender";
  }
  // De-duplicate while preserving order.
  return [bandMode, ...ALWAYS_ALLOWED.filter((m) => m !== bandMode)];
}

/** Human label for the band a value falls in (for error messages). */
export function bandLabel(estimatedMinor: bigint): string {
  if (estimatedMinor <= DIRECT_PURCHASE_CEILING_MINOR) return "<= Rs 25,000 (direct purchase, GFR R.154)";
  if (estimatedMinor <= COMMITTEE_GEM_CEILING_MINOR) return "Rs 25,001 - 2,50,000 (committee/GeM, GFR R.155)";
  if (estimatedMinor <= LIMITED_TENDER_CEILING_MINOR) return "Rs 2,50,001 - 50,00,000 (limited tender, GFR R.162)";
  return "> Rs 50,00,000 (advertised tender, GFR R.161)";
}

/**
 * Map the tender `type` enum (open/limited/single_source/gem) onto a canonical
 * ProcurementMode so band enforcement can be applied to tender creation.
 */
export function modeForTenderType(type: string): ProcurementMode {
  switch (type) {
    case "open":          return "advertised_tender";
    case "limited":       return "limited_tender";
    case "single_source": return "single_tender";
    case "gem":           return "gem";
    default:              return "advertised_tender";
  }
}

/**
 * Enforce that `mode` is permissible for `estimatedMinor` under the GFR bands.
 * Throws GfrModeError("GFR_MODE_NOT_ALLOWED") when the mode violates the band.
 *
 * A HIGHER-rigour mode than the band requires is always allowed (e.g. running an
 * advertised tender for a small value is over-procuring, never a violation). The
 * rule we enforce is the floor: you may not use a LOWER-rigour mode than the
 * band mandates (e.g. direct purchase for a Rs 10,00,000 value).
 */
export function assertModeAllowedForValue(mode: ProcurementMode, estimatedMinor: bigint): void {
  if (estimatedMinor < 0n) {
    throw new GfrModeError("GFR_INVALID_VALUE", "estimated value must be non-negative paise");
  }
  // gem and single_tender are exceptions permissible at any value (their own
  // GFR controls apply: GeM contract, single-source justification).
  if (mode === "gem" || mode === "single_tender") return;

  // Rigour ordering: lower index = lower rigour. A mode is permissible if its
  // rigour >= the band's required rigour.
  const RIGOUR: Record<string, number> = {
    direct_purchase: 0,
    limited_tender: 1,
    advertised_tender: 2,
  };
  let requiredRigour: number;
  if (estimatedMinor <= DIRECT_PURCHASE_CEILING_MINOR) requiredRigour = 0;
  else if (estimatedMinor <= LIMITED_TENDER_CEILING_MINOR) requiredRigour = 1;
  else requiredRigour = 2;

  const modeRigour = RIGOUR[mode];
  if (modeRigour === undefined) {
    throw new GfrModeError("GFR_UNKNOWN_MODE", `unknown procurement mode '${mode}'`);
  }
  if (modeRigour < requiredRigour) {
    throw new GfrModeError(
      "GFR_MODE_NOT_ALLOWED",
      `procurement mode '${mode}' is not permitted for estimated value in band ${bandLabel(estimatedMinor)}; ` +
        `permitted: ${allowedModesForValue(estimatedMinor).join(", ")}`,
    );
  }
}
