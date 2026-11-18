/**
 * MSME commercial M4: statutory configuration for GSTR-1 / GSTR-3B preparation. EVERY value here is CA-VERIFY (see
 * ~/orch-logs/segments/MSME-STATUTORY-CONFIG.md): they are placeholders from secondary sources, held in ONE place so a CA can
 * change them without touching the builders. Money is paise (bigint). Nothing here is read from edition / profile.
 */

/**
 * The pinned GSTR JSON schema version. CA-VERIFY: GSTN publishes no public machine-readable schema; the research found the
 * offline-tool "GST3.1" family only as a placeholder. A different version needs a new adapter registered in adapters.ts (the
 * builders produce a version-neutral model; only the adapter knows the wire shape). Override with GSTR_JSON_SCHEMA_VERSION.
 */
export const GSTR_JSON_SCHEMA_VERSION = process.env.GSTR_JSON_SCHEMA_VERSION?.trim() || "GST3.1";

export interface LateFeeBand { upToTurnoverMinor: bigint | null; capMinor: bigint }

export interface GstrConfig {
  jsonSchemaVersion: string;
  /** B2CL: inter-state B2C invoice value STRICTLY ABOVE this (paise). CA-VERIFY: Rs 2.5 lakh before Aug-2024, Rs 1 lakh after. */
  b2clThresholdMinor: bigint;
  /** QRMP eligibility: previous-FY aggregate turnover up to this (paise). PAN-level in law; this tenant's own GSTIN is all we see. CA-VERIFY. */
  qrmpTurnoverCeilingMinor: bigint;
  /** IFF: B2B/CDN value furnishable per month under QRMP (paise). CA-VERIFY. */
  iffMonthlyCapMinor: bigint;
  /** HSN digits required on the GSTR-1 HSN summary: [previous-FY turnover below ceiling] -> digits. CA-VERIFY. */
  hsnDigitsBelowCeiling: number;
  hsnDigitsAtOrAboveCeiling: number;
  hsnTurnoverCeilingMinor: bigint;
  /** s.50 interest, basis points per annum on the net cash liability. CA-VERIFY. */
  interestBps: bigint;
  /** s.47 late fee, paise per day, total CGST+SGST; the NIL-return rate; and caps by previous-FY turnover band. CA-VERIFY. */
  lateFeePerDayMinor: bigint;
  lateFeeNilPerDayMinor: bigint;
  lateFeeNilCapMinor: bigint;
  lateFeeBands: LateFeeBand[];
  /** GSTR-3B due day of the month after the period (monthly) / after the quarter (QRMP). CA-VERIFY (QRMP is 22nd or 24th by state group). */
  dueDayMonthly: number;
  dueDayQuarterly: number;
}

export const GSTR_CONFIG: GstrConfig = {
  jsonSchemaVersion: GSTR_JSON_SCHEMA_VERSION,
  b2clThresholdMinor: 10_000_000n,            // Rs 1,00,000
  qrmpTurnoverCeilingMinor: 5_000_000_000n,   // Rs 5 crore
  iffMonthlyCapMinor: 500_000_000n,           // Rs 50 lakh
  hsnDigitsBelowCeiling: 4,
  hsnDigitsAtOrAboveCeiling: 6,
  hsnTurnoverCeilingMinor: 5_000_000_000n,    // Rs 5 crore
  interestBps: 1800n,                         // 18% p.a.
  lateFeePerDayMinor: 5_000n,                 // Rs 50 / day (Rs 25 CGST + Rs 25 SGST)
  lateFeeNilPerDayMinor: 2_000n,              // Rs 20 / day for a NIL return
  lateFeeNilCapMinor: 50_000n,                // Rs 500
  lateFeeBands: [
    { upToTurnoverMinor: 15_000_000_000n, capMinor: 200_000n },  // up to Rs 1.5 cr: Rs 2,000
    { upToTurnoverMinor: 50_000_000_000n, capMinor: 500_000n },  // Rs 1.5 - 5 cr:   Rs 5,000
    { upToTurnoverMinor: null, capMinor: 1_000_000n },           // above Rs 5 cr:   Rs 10,000
  ],
  dueDayMonthly: 20,
  dueDayQuarterly: 22,
};

/** Place-of-supply code GSTN uses for "other country": a supply to it is an export. */
export const EXPORT_POS = "96";
export const QUARTER_END_MONTHS = [3, 6, 9, 12] as const;
