/**
 * GST split for a document line or total (CGST Act s.9 / IGST Act s.5): a supply within one
 * State or UT carries CGST + SGST at half the rate each; a supply across States carries IGST.
 * The supplier State is the first two digits of its GSTIN; the recipient side is the place of
 * supply (the buyer GSTIN prefix, or a two-digit State code). Exact paise, rounded half up.
 */

export interface GstSplit {
  kind: "intra" | "inter" | "unknown";
  cgstMinor: bigint;
  sgstMinor: bigint;
  igstMinor: bigint;
  taxMinor: bigint;
}

const GSTIN_RE = /^\d{2}[A-Z0-9]{13}$/;

/** "29ABCDE1234F1Z5" -> "29"; a bare two-digit State code is returned as is; otherwise null. */
export function gstStateCode(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toUpperCase();
  if (/^\d{2}$/.test(t)) return t;
  return GSTIN_RE.test(t) ? t.slice(0, 2) : null;
}

function roundHalfUp(num: bigint, den: bigint): bigint {
  if (num < 0n) return -roundHalfUp(-num, den);
  return (num * 2n + den) / (den * 2n);
}

/**
 * @param taxableMinor taxable value in paise
 * @param rateBp GST rate in basis points (1800 = 18%)
 * @param supplier supplier GSTIN or State code
 * @param recipient recipient GSTIN or place-of-supply State code
 */
export function gstSplit(taxableMinor: bigint, rateBp: number, supplier: string | null | undefined, recipient: string | null | undefined): GstSplit {
  const s = gstStateCode(supplier);
  const r = gstStateCode(recipient);
  const rate = BigInt(Math.max(0, Math.round(rateBp)));
  if (!s || !r) {
    const tax = roundHalfUp(taxableMinor * rate, 10_000n);
    return { kind: "unknown", cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, taxMinor: tax };
  }
  if (s === r) {
    const half = roundHalfUp(taxableMinor * rate, 20_000n);
    return { kind: "intra", cgstMinor: half, sgstMinor: half, igstMinor: 0n, taxMinor: half * 2n };
  }
  const igst = roundHalfUp(taxableMinor * rate, 10_000n);
  return { kind: "inter", cgstMinor: 0n, sgstMinor: 0n, igstMinor: igst, taxMinor: igst };
}

/** GST State / UT codes (GSTN), for "Place of supply: 07 (Delhi)". */
export const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra",
  "28": "Andhra Pradesh (before reorganisation)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};

/** "07" -> "07 (Delhi)"; unknown codes are returned as given. */
export function placeOfSupplyLabel(code: string | null | undefined): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  const name = GST_STATE_NAMES[c];
  return name ? `${c} (${name})` : c;
}
