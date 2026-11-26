/**
 * The existing geography master: Indian states and union territories keyed by ISO 3166-2:IN
 * subdivision code. Mirrors INDIAN_STATES_UTS in apps/web/src/lib/india/states.ts (the same list
 * payroll's PT / LWF rules use) so a price book's geography is a real state / UT, not free text
 * such as "north" that can never resolve. Keep the two lists in step (a parity test reads the web
 * file when it is present in the checkout).
 */
export const INDIAN_STATES_UTS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AN", name: "Andaman and Nicobar Islands" },
  { code: "AP", name: "Andhra Pradesh" },
  { code: "AR", name: "Arunachal Pradesh" },
  { code: "AS", name: "Assam" },
  { code: "BR", name: "Bihar" },
  { code: "CH", name: "Chandigarh" },
  { code: "CG", name: "Chhattisgarh" },
  { code: "DH", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "DL", name: "Delhi" },
  { code: "GA", name: "Goa" },
  { code: "GJ", name: "Gujarat" },
  { code: "HR", name: "Haryana" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "JK", name: "Jammu and Kashmir" },
  { code: "JH", name: "Jharkhand" },
  { code: "KA", name: "Karnataka" },
  { code: "KL", name: "Kerala" },
  { code: "LA", name: "Ladakh" },
  { code: "LD", name: "Lakshadweep" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "MH", name: "Maharashtra" },
  { code: "MN", name: "Manipur" },
  { code: "ML", name: "Meghalaya" },
  { code: "MZ", name: "Mizoram" },
  { code: "NL", name: "Nagaland" },
  { code: "OD", name: "Odisha" },
  { code: "PY", name: "Puducherry" },
  { code: "PB", name: "Punjab" },
  { code: "RJ", name: "Rajasthan" },
  { code: "SK", name: "Sikkim" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TS", name: "Telangana" },
  { code: "TR", name: "Tripura" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "UK", name: "Uttarakhand" },
  { code: "WB", name: "West Bengal" },
];

/**
 * Canonical state / UT code for a typed value (a code or a full name, any case), or null when it
 * is neither. Pure.
 */
export function normaliseGeography(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v === "") return null;
  const hit = INDIAN_STATES_UTS.find((s) => s.code.toLowerCase() === v || s.name.toLowerCase() === v);
  return hit ? hit.code : null;
}
