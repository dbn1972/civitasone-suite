/**
 * GAP-LEGAL-CASES-NEW-02 (owner decision #10): the seeded court / tribunal master.
 *
 * Config, not a table: it is reference data that changes by statute, not by tenant.
 * `code` is the stable machine key stored on the case (cases.legal_cases.court_code);
 * `name` is the canonical display value stored in `court`, so the "Courts / Fora" count
 * and the High Court filter never depend on how a clerk spelled it.
 * A court that is not listed is entered as "Other" (code `other`, free text) and the case
 * is marked court_verified = false.
 */
export type CourtKind = "supreme" | "high_court" | "district" | "tribunal";

export interface Court { code: string; name: string; kind: CourtKind }

/** Reserved code for a court that is not in the master. */
export const OTHER_COURT_CODE = "other";

const HIGH_COURTS: ReadonlyArray<[string, string]> = [
  ["allahabad", "Allahabad"], ["andhra_pradesh", "Andhra Pradesh"], ["bombay", "Bombay"], ["calcutta", "Calcutta"],
  ["chhattisgarh", "Chhattisgarh"], ["delhi", "Delhi"], ["gauhati", "Gauhati"], ["gujarat", "Gujarat"],
  ["himachal_pradesh", "Himachal Pradesh"], ["jk_ladakh", "Jammu & Kashmir and Ladakh"], ["jharkhand", "Jharkhand"],
  ["karnataka", "Karnataka"], ["kerala", "Kerala"], ["madhya_pradesh", "Madhya Pradesh"], ["madras", "Madras"],
  ["manipur", "Manipur"], ["meghalaya", "Meghalaya"], ["orissa", "Orissa"], ["patna", "Patna"],
  ["punjab_haryana", "Punjab and Haryana"], ["rajasthan", "Rajasthan"], ["sikkim", "Sikkim"], ["telangana", "Telangana"],
  ["tripura", "Tripura"], ["uttarakhand", "Uttarakhand"],
];

const DISTRICT: ReadonlyArray<[string, string]> = [
  ["dist_sessions", "District and Sessions Court"],
  ["dist_civil_sr", "Civil Judge (Senior Division) Court"],
  ["dist_civil_jr", "Civil Judge (Junior Division) Court"],
  ["dist_magistrate", "Chief Judicial Magistrate / Judicial Magistrate Court"],
  ["dist_family", "Family Court"],
  ["dist_commercial", "Commercial Court"],
  ["dist_labour", "Labour Court / Industrial Tribunal"],
  ["dist_mact", "Motor Accidents Claims Tribunal"],
  ["dist_consumer", "District Consumer Disputes Redressal Commission"],
];

const TRIBUNALS: ReadonlyArray<[string, string]> = [
  ["ngt", "National Green Tribunal"], ["nclt", "National Company Law Tribunal"],
  ["nclat", "National Company Law Appellate Tribunal"], ["cat", "Central Administrative Tribunal"],
  ["sat_admin", "State Administrative Tribunal"], ["itat", "Income Tax Appellate Tribunal"],
  ["cestat", "Customs, Excise and Service Tax Appellate Tribunal"], ["sat", "Securities Appellate Tribunal"],
  ["tdsat", "Telecom Disputes Settlement and Appellate Tribunal"], ["aptel", "Appellate Tribunal for Electricity"],
  ["drt", "Debts Recovery Tribunal"], ["drat", "Debts Recovery Appellate Tribunal"], ["aft", "Armed Forces Tribunal"],
  ["ncdrc", "National Consumer Disputes Redressal Commission"], ["scdrc", "State Consumer Disputes Redressal Commission"],
  ["rera_tribunal", "Real Estate Appellate Tribunal"], ["rent_tribunal", "Rent Control Tribunal"],
  ["revenue_court", "Revenue Court / Board of Revenue"],
];

export const COURT_MASTER: ReadonlyArray<Court> = [
  { code: "sc_india", name: "Supreme Court of India", kind: "supreme" },
  ...HIGH_COURTS.map(([code, n]): Court => ({ code: `hc_${code}`, name: `High Court of ${n}`, kind: "high_court" })),
  ...DISTRICT.map(([code, name]): Court => ({ code, name, kind: "district" })),
  ...TRIBUNALS.map(([code, name]): Court => ({ code, name, kind: "tribunal" })),
];

const BY_CODE = new Map(COURT_MASTER.map((c) => [c.code, c]));

export function findCourt(code: string): Court | undefined {
  return BY_CODE.get(code);
}
