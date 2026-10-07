/**
 * GAP-REPORTS-MIS-02: classify a free-text "change"/"trend" string into a
 * direction. The MIS page and MISMetricsTable previously classified trend by a
 * raw `change.startsWith("+")` / `startsWith("-")` check, so a change like
 * "12%" (no sign), "0%", or "−4" written with a Unicode minus (U+2212) or an
 * en/em dash was counted neither up nor down and shown uncoloured — a silent
 * mis-count on management dashboards.
 *
 * This normaliser:
 *  - treats U+2212 (−), en dash (–) and em dash (—) as an ASCII minus,
 *  - strips %, whitespace and thousands separators,
 *  - reads an explicit leading sign (+/-) first, then falls back to the parsed
 *    numeric sign for an unsigned value ("12%" -> up, "-3" -> down, "0%" ->
 *    flat),
 *  - returns "unknown" for a null/empty/unparseable value, so the caller can
 *    render a neutral, uncounted cue rather than guessing.
 *
 * The accompanying DECISION (recorded for HUMAN REVIEW): an unsigned positive
 * number such as "12%" is read as an INCREASE ("up"), matching how a plain
 * "+12%" would read and how the old code already treated a leading "+". A bare
 * "0"/"0%" is "flat". If the API later makes `change` a signed number this
 * helper still works unchanged.
 */
export type TrendDirection = "up" | "down" | "flat" | "unknown";

/** Characters other than ASCII '-' that mean "minus" in human-entered copy. */
const MINUS_LIKE = /[\u2212\u2013\u2014]/g; // − (minus sign), – (en dash), — (em dash)

export function parseChange(change: string | number | null | undefined): TrendDirection {
  if (change === null || change === undefined) return "unknown";

  if (typeof change === "number") {
    if (!Number.isFinite(change)) return "unknown";
    if (change > 0) return "up";
    if (change < 0) return "down";
    return "flat";
  }

  // Normalise minus-like glyphs to ASCII '-' before anything else.
  const normalised = change.replace(MINUS_LIKE, "-").trim();
  if (normalised === "") return "unknown";

  // An explicit leading sign is authoritative (handles "+0" / "-0" too).
  const explicitSign = normalised[0] === "+" ? "+" : normalised[0] === "-" ? "-" : null;

  // Strip sign, %, spaces and thousands separators, then parse the magnitude.
  const magnitudeText = normalised
    .replace(/^[+-]/, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .replace(/,/g, "");
  const magnitude = Number(magnitudeText);
  if (!Number.isFinite(magnitude)) return "unknown";

  if (explicitSign === "-") return magnitude === 0 ? "flat" : "down";
  if (explicitSign === "+") return magnitude === 0 ? "flat" : "up";

  // Unsigned: use the parsed numeric sign. "12%" -> up, "0%" -> flat.
  if (magnitude > 0) return "up";
  if (magnitude < 0) return "down"; // e.g. a stray "4-" normalises oddly; defensive only.
  return "flat";
}

/** The CSS colour var for a trend direction, or undefined for flat/unknown. */
export function trendColor(direction: TrendDirection): string | undefined {
  if (direction === "up") return "var(--good)";
  if (direction === "down") return "var(--bad)";
  return undefined;
}

/** A non-colour (sign) cue so trend is legible without relying on colour alone. */
export function trendCue(direction: TrendDirection): string {
  if (direction === "up") return "▲";
  if (direction === "down") return "▼";
  if (direction === "flat") return "■";
  return "–";
}
