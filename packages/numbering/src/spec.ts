/**
 * Number-format specification — the config model behind a named reference
 * format (e.g. "procurement.po" -> `PO/2026-27/000123`). Pure & serialisable;
 * the same shape is persisted per-tenant in `metadata.number_formats` and used
 * by the pure formatter and the gapless allocator.
 */

/** Counter reset cadence. `never` = one monotonic series forever. */
export type ResetPolicy = "never" | "yearly" | "monthly";

export interface NumberFormatSpec {
  /** Literal prefix segment, e.g. "PO", "IND", "CERT". May be empty. */
  prefix: string;
  /** Embed the financial-year segment (e.g. "2026-27") between prefix and counter. */
  embedFinancialYear: boolean;
  /** First month of the financial year (1-12). India defaults to 4 (April). */
  fyStartMonth: number;
  /** Zero-pad width of the counter segment. */
  counterWidth: number;
  /** Separator joining the segments. */
  separator: string;
  /** When the counter resets to 1. */
  resetPolicy: ResetPolicy;
}

export type NumberFormatSpecInput = Partial<NumberFormatSpec> & { prefix?: string };

export const DEFAULT_SPEC: NumberFormatSpec = {
  prefix: "",
  embedFinancialYear: true,
  fyStartMonth: 4,
  counterWidth: 6,
  separator: "/",
  resetPolicy: "yearly",
};

const RESET_POLICIES: ReadonlySet<string> = new Set(["never", "yearly", "monthly"]);

/**
 * Fill defaults and validate a partial spec. Throws `RangeError` on an invalid
 * field so a malformed format is rejected at define-time, never at allocate-time.
 */
export function normalizeSpec(input: NumberFormatSpecInput): NumberFormatSpec {
  const spec: NumberFormatSpec = {
    prefix: input.prefix ?? DEFAULT_SPEC.prefix,
    embedFinancialYear: input.embedFinancialYear ?? DEFAULT_SPEC.embedFinancialYear,
    fyStartMonth: input.fyStartMonth ?? DEFAULT_SPEC.fyStartMonth,
    counterWidth: input.counterWidth ?? DEFAULT_SPEC.counterWidth,
    separator: input.separator ?? DEFAULT_SPEC.separator,
    resetPolicy: input.resetPolicy ?? DEFAULT_SPEC.resetPolicy,
  };
  if (!Number.isInteger(spec.fyStartMonth) || spec.fyStartMonth < 1 || spec.fyStartMonth > 12) {
    throw new RangeError(`fyStartMonth must be an integer 1-12, got ${spec.fyStartMonth}`);
  }
  if (!Number.isInteger(spec.counterWidth) || spec.counterWidth < 1 || spec.counterWidth > 18) {
    throw new RangeError(`counterWidth must be an integer 1-18, got ${spec.counterWidth}`);
  }
  if (spec.separator.length > 4) {
    throw new RangeError(`separator must be at most 4 chars, got ${JSON.stringify(spec.separator)}`);
  }
  if (spec.prefix.length > 32) {
    throw new RangeError(`prefix must be at most 32 chars, got length ${spec.prefix.length}`);
  }
  if (!RESET_POLICIES.has(spec.resetPolicy)) {
    throw new RangeError(`resetPolicy must be one of never|yearly|monthly, got ${spec.resetPolicy}`);
  }
  return spec;
}
