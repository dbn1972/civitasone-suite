/** GFR 2017 / PFMS mandate: dates displayed as dd/MM/yyyy in Indian locale. */
export function formatIndianDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Format money already expressed in RUPEES (not paise) as a ₹ string with en-IN
 * (lakh/crore) grouping and 2 decimals. Use this for the few API fields that return
 * rupees rather than minor units (e.g. payroll-runs grossAmount/netAmount). Do NOT
 * pass a rupee value to formatMoney() — that treats it as paise and shows 100x too small.
 *
 * UX-006: null/undefined/non-finite is MISSING data, not a real zero — it renders
 * "—" (same convention as formatBps/formatIndianDate), never a fabricated ₹0.00.
 *
 *   formatRupees(90000)   -> "₹90,000.00"
 *   formatRupees(null)    -> "—"
 *   formatRupees(NaN)     -> "—"
 */
export function formatRupees(rupees: number | string | null | undefined): string {
  if (rupees === null || rupees === undefined || rupees === "") return "—";
  const n = typeof rupees === "number" ? rupees : Number(rupees);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format money held in MINOR units (paise) as a ₹ string with en-IN (lakh/crore)
 * grouping and exactly 2 decimal places. Paise-correct: works on bigint, number,
 * or numeric string without floating-point drift on the rupee/paise split.
 *
 * UX-006: null/undefined/empty/unparseable is MISSING data, not a real zero — it
 * renders "—" (same convention as formatBps/formatIndianDate), never a fabricated
 * ₹0.00 that would be indistinguishable from a genuine zero-rupee amount.
 *
 *   formatMoney(123456789n)  -> "₹12,34,567.89"
 *   formatMoney(100)         -> "₹1.00"
 *   formatMoney("-2550")     -> "-₹25.50"
 *   formatMoney(null)        -> "—"
 *   formatMoney(undefined)   -> "—"
 *   formatMoney("garbage")   -> "—"
 */
export function formatMoney(minorUnits: bigint | number | string | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined || minorUnits === "") return "—";

  let minor: bigint;
  try {
    if (typeof minorUnits === "bigint") {
      minor = minorUnits;
    } else if (typeof minorUnits === "number") {
      if (!Number.isFinite(minorUnits)) return "—";
      // Round to the nearest paisa to absorb any float imprecision before BigInt.
      minor = BigInt(Math.round(minorUnits));
    } else {
      const trimmed = minorUnits.trim();
      if (trimmed === "") return "—";
      if (/^[+-]?\d+$/.test(trimmed)) {
        minor = BigInt(trimmed);
      } else {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return "—";
        minor = BigInt(Math.round(n));
      }
    }
  } catch {
    return "—";
  }

  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const rupees = abs / 100n;
  const paise = abs % 100n;

  const rupeesStr = rupees.toString();
  // Indian grouping: last 3 digits, then groups of 2.
  let grouped: string;
  if (rupeesStr.length <= 3) {
    grouped = rupeesStr;
  } else {
    const head = rupeesStr.slice(0, rupeesStr.length - 3);
    const tail = rupeesStr.slice(rupeesStr.length - 3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  }

  const paiseStr = paise.toString().padStart(2, "0");
  return `${negative ? "-" : ""}₹${grouped}.${paiseStr}`;
}

/**
 * UX-006 type guard: safely convert a MINOR-units (paise) field to a plain
 * rupee `number` for arithmetic/comparisons or a form-input default — WITHOUT
 * silently turning missing data into a real-looking 0. Prefer this over a bare
 * `Number(x.someMinor) / 100`, which maps both `null` and unparseable input to
 * 0 (a value indistinguishable from an actual zero amount downstream). Returns
 * `null` for null/undefined/non-finite so callers can propagate "missing"
 * instead of computing on a fabricated zero.
 *
 *   minorToRupeesOrNull(12345)    -> 123.45
 *   minorToRupeesOrNull(null)     -> null
 *   minorToRupeesOrNull(undefined)-> null
 *   minorToRupeesOrNull("abc")    -> null
 */
export function minorToRupeesOrNull(minor: bigint | number | string | null | undefined): number | null {
  if (minor === null || minor === undefined || minor === "") return null;
  const n = typeof minor === "bigint" ? Number(minor) : typeof minor === "number" ? minor : Number(minor);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

/**
 * Format a basis-points integer (1 bp = 0.01%) as a percent string for display,
 * stripping trailing zeros. Renders the *exact* bps/100 value — never rounds a
 * statutory rate/threshold before showing it.
 *
 *   formatBps(1200) -> "12%"
 *   formatBps(550)  -> "5.5%"
 *   formatBps(12)   -> "0.12%"
 */
export function formatBps(bps: number | string | null | undefined): string {
  if (bps === null || bps === undefined || bps === "") return "—";
  const n = typeof bps === "number" ? bps : Number(bps);
  if (!Number.isFinite(n)) return "—";
  const pct = n / 100;
  const fixed = pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${fixed}%`;
}
