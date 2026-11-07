/**
 * Indian date entry (UX-R5 form-field standard, GLB-10): officers type and read DD-MM-YYYY; the value the app
 * stores and sends is always ISO YYYY-MM-DD. Pure helpers shared by ds/DateInput and ds/Field blur validation.
 * A native <input type=date> follows the browser locale (mm/dd/yyyy even under en-IN), which made "02-11-2026"
 * become 11 Feb; these helpers never guess the order: day first, always.
 */
import { isRealCalendarDate } from "@/lib/calendarDate";
import { defaultRecordT, type RecordT } from "@/lib/records/messages";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-04" -> "04-11-2026"; anything else -> "". */
export function isoToIndianText(iso: string | null | undefined): string {
  const m = ISO_RE.exec((iso ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/**
 * Mask what is being typed: keep digits, insert "-" after DD and MM, cap at DD-MM-YYYY. A pasted ISO date
 * (2026-11-04) is converted to the Indian order instead of being mangled.
 */
export function maskIndianDateText(raw: string): string {
  const trimmed = raw.trim();
  const iso = ISO_RE.exec(trimmed);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  // "4/11/2026" or "4.11.2026": a complete date typed with separators and single-digit parts is padded.
  const sep = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed);
  if (sep) return `${sep[1]!.padStart(2, "0")}-${sep[2]!.padStart(2, "0")}-${sep[3]}`;
  const d = trimmed.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
}

/** "04-11-2026" (or 04/11/2026, 04.11.2026) -> "2026-11-04" when it is a real calendar date; otherwise null. */
export function parseIndianDateText(text: string | null | undefined): string | null {
  const m = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec((text ?? "").trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isRealCalendarDate(iso) ? iso : null;
}

export type DateTextRules = { required?: boolean; min?: string; max?: string; label?: string };

/** The inline message for a typed date, or undefined when it is acceptable. `t` is the recordUi translator. */
export function dateTextError(text: string, rules: DateTextRules = {}, t: RecordT = defaultRecordT): string | undefined {
  const v = text.trim();
  const label = rules.label?.trim() || t("dateLabel");
  if (!v) return rules.required ? t("dateEnter", { label: label.toLowerCase() }) : undefined;
  const iso = parseIndianDateText(v);
  if (!iso) {
    return /^\d{2}-\d{2}-\d{4}$/.test(v) ? t("dateNotReal", { value: v }) : t("dateFormat", { label: label.toLowerCase() });
  }
  if (rules.min && iso < rules.min) return t("dateBefore", { label, date: isoToIndianText(rules.min) });
  if (rules.max && iso > rules.max) return t("dateAfter", { label, date: isoToIndianText(rules.max) });
  return undefined;
}
