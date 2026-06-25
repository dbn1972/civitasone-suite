/** GFR 2017 / PFMS mandate: dates displayed as dd/MM/yyyy in Indian locale. */
export function formatIndianDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Format money held in MINOR units (paise) as a ₹ string with en-IN (lakh/crore)
 * grouping and exactly 2 decimal places. Paise-correct: works on bigint, number,
 * or numeric string without floating-point drift on the rupee/paise split.
 *
 *   formatMoney(123456789n) -> "₹12,34,567.89"
 *   formatMoney(100)        -> "₹1.00"
 *   formatMoney("-2550")    -> "-₹25.50"
 */
export function formatMoney(minorUnits: bigint | number | string): string {
  let minor: bigint;
  try {
    if (typeof minorUnits === "bigint") {
      minor = minorUnits;
    } else if (typeof minorUnits === "number") {
      // Round to the nearest paisa to absorb any float imprecision before BigInt.
      minor = BigInt(Math.round(minorUnits));
    } else {
      const trimmed = minorUnits.trim();
      // Accept plain integer strings; fall back to rounding for decimal/float strings.
      minor = /^[+-]?\d+$/.test(trimmed)
        ? BigInt(trimmed)
        : BigInt(Math.round(Number(trimmed) || 0));
    }
  } catch {
    return "₹0.00";
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
