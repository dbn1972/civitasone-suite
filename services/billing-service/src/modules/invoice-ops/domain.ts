/** Pure rules for offline payments and reminders (no I/O). */
export const OFFLINE_MODES = ["neft", "rtgs", "cheque", "dd"] as const;
export type OfflineMode = (typeof OFFLINE_MODES)[number];

/**
 * Instrument/UTR formats per mode (VERIFY: conservative shapes, upper-cased and stripped of spaces):
 *   NEFT   16 chars, 4-letter bank code + 12 alphanumerics (e.g. SBIN523345678901)
 *   RTGS   22 chars, 4-letter bank code + 18 alphanumerics (e.g. HDFCR52023010112345678)
 *   cheque 6 digits (MICR cheque number)
 *   DD     6-12 digits (draft number)
 */
const REFERENCE_RULES: Record<OfflineMode, { re: RegExp; hint: string }> = {
  neft: { re: /^[A-Z]{4}[A-Z0-9]{12}$/, hint: "a NEFT UTR is 16 characters: a 4-letter bank code followed by 12 letters or digits" },
  rtgs: { re: /^[A-Z]{4}[A-Z0-9]{18}$/, hint: "an RTGS UTR is 22 characters: a 4-letter bank code followed by 18 letters or digits" },
  cheque: { re: /^\d{6}$/, hint: "a cheque number is 6 digits" },
  dd: { re: /^\d{6,12}$/, hint: "a demand draft number is 6 to 12 digits" },
};

export function normaliseReference(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}
export function referenceProblem(mode: OfflineMode, referenceNorm: string): string | null {
  const rule = REFERENCE_RULES[mode];
  return rule.re.test(referenceNorm) ? null : rule.hint;
}

/** Today's calendar date in India (YYYY-MM-DD): "not in the future" is judged against the office date. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** paid-on must be a real date, not in the future, and not before the invoice date. */
export function paidOnProblem(paidOn: string, today: string, invoiceDate: string): string | null {
  const d = new Date(`${paidOn}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== paidOn) return "must be a valid date (YYYY-MM-DD)";
  if (paidOn > today) return "cannot be in the future";
  if (paidOn < invoiceDate) return "cannot be before the invoice date";
  return null;
}

/** States an invoice can be settled from. Webhook-paid (`paid`), cancelled, waived and draft bills are never touched. */
export const SETTLEABLE_STATUSES = ["issued", "partially_paid", "overdue"] as const;
export const isSettleable = (status: string): boolean => (SETTLEABLE_STATUSES as readonly string[]).includes(status);

/** Offline settlement is full-amount only: the request must equal the outstanding balance. */
export function amountProblem(totalMinor: bigint, paidMinor: bigint, amountMinor: bigint): string | null {
  const outstanding = totalMinor - paidMinor;
  if (outstanding <= 0n) return "the invoice has nothing outstanding";
  return amountMinor === outstanding ? null : `must equal the outstanding amount (${outstanding} paise); partial offline payments are not supported`;
}

export const MANUAL_REMINDER_WINDOW_MS = 24 * 3600_000;
export const SCHEDULED_REMINDER_WINDOW_MS = 7 * 24 * 3600_000;

/** Rupee string from integer paise with lakh/crore grouping, without floating point. */
export function formatPaise(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const rupees = (abs / 100n).toString();
  const paise = (abs % 100n).toString().padStart(2, "0");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${neg ? "-" : ""}Rs ${grouped}.${paise}`;
}
