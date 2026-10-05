/**
 * Scan-link (Finance target) — pure matching rules. No DB, no I/O.
 *
 * A scanned bill/voucher/receipt may be attached to a finance record ONLY when
 *   (1) the scan-extracted reference equals one of the record's references after normalisation
 *       (lower-case, everything except [a-z0-9] removed), AND
 *   (2) the scan-extracted amount equals one of the record's amounts in PAISE (bigint) EXACTLY (no tolerance:
 *       a difference of even 1 paise is flagged, never auto-attached).
 * Anything else is flagged, never attached. Amounts are bigint end to end; no Number() on money.
 */

export type ScanTargetKind = "finance_payment" | "finance_voucher" | "finance_bill";

/** Lower-case and strip everything except [a-z0-9]. MUST stay identical to the SQL index expression in migration 0091. */
export function normaliseReference(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Show only the last 4 characters of a reference (masked form; not used in result reasons). */
export function maskReference(raw: string | null | undefined): string {
  const n = (raw ?? "").trim();
  if (n.length === 0) return "(none)";
  return n.length <= 4 ? "****" : "****" + n.slice(-4);
}

/** Strict non-negative integer string -> bigint, else null. */
export function parseMinor(raw: string | null | undefined): bigint | null {
  if (raw == null || !/^\d{1,18}$/.test(raw)) return null;
  return BigInt(raw);
}

/** Indian-grouped paise display ("1,23,45,678.90") using bigint only. */
export function formatPaise(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const rupees = (abs / 100n).toString();
  const paise = (abs % 100n).toString().padStart(2, "0");
  const grouped = rupees.length <= 3
    ? rupees
    : rupees.slice(0, rupees.length - 3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + rupees.slice(-3);
  return `${neg ? "-" : ""}${grouped}.${paise}`;
}

export interface TargetFacts {
  /** Every reference the record is known by (voucher no, bill no, EFT ref, UTR ...). */
  references: Array<string | null | undefined>;
  /** Every amount (paise) that counts as "the record amount" (bill: gross and net). First = primary. */
  amountsMinor: bigint[];
}

export type MatchOutcome =
  | { outcome: "match"; matchedReference: string; matchedAmountMinor: bigint }
  | { outcome: "amount_mismatch"; reason: "AMOUNT_MISMATCH"; detail: ResultDetail }
  | { outcome: "reference_mismatch"; reason: "REFERENCE_MISMATCH"; detail: ResultDetail }
  | { outcome: "hint_missing"; reason: "MISSING_MATCH_HINT"; detail: ResultDetail };

/** PII-free structured context (scalars only; paise as digit strings). Never reference text. */
export type ResultDetail = Record<string, string>;

export function evaluateMatch(
  hint: { reference: string | null; amountMinor: string | null } | undefined,
  target: TargetFacts,
): MatchOutcome {
  const scanRef = normaliseReference(hint?.reference);
  const scanAmount = parseMinor(hint?.amountMinor);
  const primary = target.amountsMinor[0] ?? 0n;

  if (!hint || scanRef === "" || scanAmount === null) {
    const missing = scanRef === "" && scanAmount === null ? "both" : scanRef === "" ? "reference" : "amount";
    return { outcome: "hint_missing", reason: "MISSING_MATCH_HINT", detail: { missing, expectedMinor: primary.toString() } };
  }

  const refMatches = target.references.some((r) => normaliseReference(r) === scanRef);
  if (!refMatches) {
    return {
      outcome: "reference_mismatch",
      reason: "REFERENCE_MISMATCH",
      detail: { expectedMinor: primary.toString(), scannedMinor: scanAmount.toString() },
    };
  }

  const hit = target.amountsMinor.find((a) => a === scanAmount);
  if (hit === undefined) {
    return {
      outcome: "amount_mismatch",
      reason: "AMOUNT_MISMATCH",
      detail: { expectedMinor: primary.toString(), scannedMinor: scanAmount.toString() },
    };
  }
  return { outcome: "match", matchedReference: hint.reference ?? "", matchedAmountMinor: hit };
}
