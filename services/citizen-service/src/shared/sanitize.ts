import { z } from "zod";

/**
 * P1-7 input sanitation — shared, reusable Zod factories for citizen-facing
 * free-text. Closes three gaps uniformly across every module:
 *   1. max-length cap        — DB columns are mostly `text` (no length backstop),
 *                              so the cap MUST live at the validation layer.
 *   2. control-char stripping — remove C0/C1 control characters (keeping the
 *                              tab/newline whitelist for multi-line fields) so a
 *                              payload cannot smuggle NULs, terminators or ANSI
 *                              escapes into logs, DB or downstream consumers.
 *   3. CSV/formula-injection guard — neutralise a leading = + - @ TAB CR so a
 *                              stored value can never become an executable
 *                              spreadsheet formula in any future export.
 *
 * The transform is idempotent: re-running it over already-sanitised text is a
 * no-op, so it is safe on retried/replayed commands.
 */

// C0 controls U+0000-U+001F and C1/DEL controls U+007F-U+009F.
// Single-line strips ALL of them; multi-line keeps \n (0x0A) and \t (0x09).
const CONTROL_CHARS_SINGLELINE = /[\u0000-\u001F\u007F-\u009F]/g;
const CONTROL_CHARS_MULTILINE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
// Spreadsheet formula triggers when a cell begins with one of these.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function stripControlChars(value: string, multiline = false): string {
  return value.replace(multiline ? CONTROL_CHARS_MULTILINE : CONTROL_CHARS_SINGLELINE, "");
}

/** Neutralise a leading formula trigger by prefixing a single quote (Excel/Sheets convention). */
export function guardCsvInjection(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

interface SafeTextOptions {
  /** Maximum length AFTER trimming/sanitising. */
  max: number;
  /** Minimum length AFTER trimming/sanitising. Default 1. Use 0 to allow empty. */
  min?: number;
  /** Allow embedded newlines/tabs (descriptions, notes). Default false (single-line). */
  multiline?: boolean;
}

/**
 * A trimmed, length-capped, control-char-stripped, CSV-injection-guarded string.
 * Order: trim -> strip control chars -> CSV-guard -> length checks. Length is
 * validated AFTER sanitisation so the cap reflects what is actually stored.
 */
export function safeText(opts: SafeTextOptions) {
  const min = opts.min ?? 1;
  const multiline = opts.multiline ?? false;
  return z
    .string()
    .transform((v) => guardCsvInjection(stripControlChars(v.trim(), multiline)))
    .pipe(z.string().min(min).max(opts.max));
}
