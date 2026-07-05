/**
 * LTC (Leave Travel Concession) tax exemption — Sec 10(5).
 *
 * Pure function. Computes the exempt portion of an approved LTC fare claim.
 * The exempt amount is the LESSER of the actual fare spent and the fare
 * entitlement for the employee's entitled class of travel. Maximum 2 trips per
 * 4-year block; carry-forward of 1 unused trip to first year of next block.
 *
 * All amounts in paise (bigint).
 */

export interface LtcExemptionInput {
  /** Approved fare amount from HRMS claim (paise). */
  approvedFareMinor: bigint;
  /** Maximum fare entitlement per entitled class of travel (paise). */
  entitlementMinor: bigint;
  /** LTC type: hometown or all_india. */
  ltcType: "hometown" | "all_india";
  /** Block year (e.g. "2022-25", "2026-29"). */
  blockYear: string;
  /** Number of LTC trips already used in this block (including carry-forward). */
  usedInBlock: number;
}

export interface LtcExemptionResult {
  /** Amount exempt under Sec 10(5) (paise). */
  exemptMinor: bigint;
  /** Amount taxable as perquisite (paise). */
  taxableMinor: bigint;
  section: "10(5)";
  reason: string;
}

/**
 * Sec 10(5): LTC fare exemption.
 *
 * Rules:
 * 1. Exempt amount = LEAST(actual approved fare, entitled class fare limit).
 * 2. Max 2 journeys per 4-year block.
 * 3. If usedInBlock >= 2, entire fare is taxable (no exemption available).
 * 4. The caller must track block-year usage externally (from ltc_exemptions table).
 */
export function computeLtcExemption(input: LtcExemptionInput): LtcExemptionResult {
  const { approvedFareMinor, entitlementMinor, ltcType, blockYear, usedInBlock } = input;

  if (approvedFareMinor <= 0n) {
    return {
      exemptMinor: 0n,
      taxableMinor: 0n,
      section: "10(5)",
      reason: "no LTC fare claimed",
    };
  }

  // Block year limit: max 2 trips per block
  if (usedInBlock >= 2) {
    return {
      exemptMinor: 0n,
      taxableMinor: approvedFareMinor,
      section: "10(5)",
      reason: `block ${blockYear}: already used ${usedInBlock} trips (max 2) — entire fare taxable`,
    };
  }

  // Exempt = lesser of actual fare and entitlement
  const exempt = approvedFareMinor < entitlementMinor ? approvedFareMinor : entitlementMinor;
  const taxable = approvedFareMinor - exempt;

  return {
    exemptMinor: exempt,
    taxableMinor: taxable < 0n ? 0n : taxable,
    section: "10(5)",
    reason: `LTC ${ltcType} block ${blockYear}: exempt=${exempt}, entitlement=${entitlementMinor}, trip #${usedInBlock + 1}`,
  };
}
