import { formatMoney } from "@/lib/formatters";

/**
 * GAP-PAYROLL-RUNS-01: one adapter for payroll-run money.
 *
 * The payroll-runs API (GET /v1/payroll/runs, /runs/:id) sends every run total
 * twice: as exact integer PAISE digit-strings (`grossMinor` / `netMinor` /
 * `deductionsMinor`, bigint-safe) and, for older clients, as RUPEE floats
 * (`grossAmount` / `netAmount` / `deductions`, = paise / 100). The run-detail
 * response embeds the same pair per salary slip (`grossMinor` / `deductionsMinor`
 * / `netMinor` next to `gross` / `deductions` / `net`).
 *
 * Every payroll-run screen reads its money through this module, so
 * /hr/payroll, /hr/payroll/runs and /hr/payroll/[id] cannot drift: the exact
 * paise string is preferred and rendered with formatMoney; the rupee float is
 * used only when the paise string is absent (an older payroll-service) and is
 * converted to paise by decimal-string arithmetic here, never `x * 100`.
 */

/** The run-level money fields the API may carry (all optional on purpose). */
export type RunMoneySource = {
  grossAmount?: number | null;
  netAmount?: number | null;
  deductions?: number | null;
  grossMinor?: string | null;
  netMinor?: string | null;
  deductionsMinor?: string | null;
};

export type RunMoneyField = "gross" | "net" | "deductions";

const MINOR_DIGITS = /^-?\d+$/;

const MINOR_KEY = { gross: "grossMinor", net: "netMinor", deductions: "deductionsMinor" } as const;
const LEGACY_KEY = { gross: "grossAmount", net: "netAmount", deductions: "deductions" } as const;

/**
 * LEGACY ONLY. Convert a rupee float (the pre-*Minor wire format, always
 * paise / 100) to integer paise. `Number.prototype.toFixed(2)` yields the exact
 * 2-decimal expansion of the double, so the paise are read off the decimal
 * string with BigInt -- no float multiplication and no Math.round on money.
 * Returns null for a missing / non-finite value or one too large to print
 * without an exponent (>= 1e21), which is never a real payroll figure.
 */
export function legacyRupeesToMinor(rupees: number | null | undefined): bigint | null {
  if (typeof rupees !== "number" || !Number.isFinite(rupees)) return null;
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(rupees.toFixed(2));
  if (!match) return null;
  const minor = BigInt(`${match[2]}${match[3]}`);
  return match[1] === "-" ? -minor : minor;
}

/** A well-formed integer-paise digit string -> bigint, anything else -> null. */
export function parseMinorString(value: string | null | undefined): bigint | null {
  return typeof value === "string" && MINOR_DIGITS.test(value) ? BigInt(value) : null;
}

/**
 * Exact paise for one figure: the API's integer string when it is well-formed,
 * otherwise the legacy rupee float. null = the figure is genuinely missing
 * (render "—", never a fabricated zero).
 */
export function minorOrLegacy(
  minor: string | null | undefined,
  legacyRupees: number | null | undefined,
): bigint | null {
  return parseMinorString(minor) ?? legacyRupeesToMinor(legacyRupees);
}

/** Exact paise of a run-level total (see minorOrLegacy). */
export function runMinor(run: RunMoneySource, field: RunMoneyField): bigint | null {
  return minorOrLegacy(run[MINOR_KEY[field]], run[LEGACY_KEY[field]]);
}

/** "₹1,23,456.78" for a run-level total, "—" when it is missing. */
export function formatRunMoney(run: RunMoneySource, field: RunMoneyField): string {
  const minor = runMinor(run, field);
  return minor === null ? "—" : formatMoney(minor);
}

/** "₹90,000.00" for an exact integer-paise digit string, "—" when absent / malformed. */
export function formatMinorString(minor: string | null | undefined): string {
  const value = parseMinorString(minor);
  return value === null ? "—" : formatMoney(value);
}

/** Same as {@link minorOrLegacy} then formatMoney: for the per-slip pairs. */
export function formatMinorOrLegacy(
  minor: string | null | undefined,
  legacyRupees: number | null | undefined,
): string {
  const value = minorOrLegacy(minor, legacyRupees);
  return value === null ? "—" : formatMoney(value);
}

/**
 * |numerator| / denominator as a percentage with ONE decimal, rounded HALF-UP
 * on the exact integer ratio (e.g. 1n / 3n -> "33.3", 5n / 8n -> "62.5",
 * 1n / 16n -> "6.3"). BigInt end to end. null when the denominator is not
 * positive (a ratio against zero is meaningless, not 0%).
 */
export function percentOneDecimal(numerator: bigint, denominator: bigint): string | null {
  if (denominator <= 0n) return null;
  const abs = numerator < 0n ? -numerator : numerator;
  const tenths = (abs * 2000n + denominator) / (2n * denominator);
  return `${tenths / 10n}.${tenths % 10n}`;
}
