/**
 * GAP-ADMIN-INVOICES-06: the invoice detail's offline-payment and reminder model. Pure and client-safe
 * (the server loader and the browser dialogs both use it). Mirrors the billing-service rules so a
 * mistake is caught before a round trip; the server stays the authority.
 */
export const OFFLINE_MODES = ["neft", "rtgs", "cheque", "dd"] as const;
export type OfflineMode = (typeof OFFLINE_MODES)[number];

export type OfflinePaymentView = {
  id: string;
  mode: OfflineMode | string;
  reference: string;
  paidOn: string;
  amountMinor: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | string;
  decisionReason: string | null;
  autoApproved: boolean;
  requestedByMe: boolean;
  canDecide: boolean;
  createdAt: string;
  decidedAt: string | null;
};
export type ReminderView = { lastSentAt: string | null; nextAllowedAt: string | null; count: number };

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nstr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Null when the body is not a list, so a bad answer is an error and never "no payments". */
export function mapOfflinePayments(p: unknown): OfflinePaymentView[] | null {
  const rows = rec(p) && Array.isArray(p.data) ? p.data : null;
  if (!rows) return null;
  return rows.filter(rec).map((r) => ({
    id: str(r.id), mode: str(r.mode), reference: str(r.reference), paidOn: str(r.paidOn), amountMinor: /^\d+$/.test(str(r.amountMinor)) ? str(r.amountMinor) : "0",
    reason: str(r.reason), status: str(r.status), decisionReason: nstr(r.decisionReason), autoApproved: r.autoApproved === true,
    requestedByMe: r.requestedByMe === true, canDecide: r.canDecide === true, createdAt: str(r.createdAt), decidedAt: nstr(r.decidedAt),
  }));
}
export function mapReminderStatus(p: unknown): ReminderView | null {
  const d = rec(p) && rec(p.data) ? p.data : null;
  if (!d) return null;
  return { lastSentAt: nstr(d.lastSentAt), nextAllowedAt: nstr(d.nextAllowedAt), count: typeof d.count === "number" ? d.count : 0 };
}

export type BillingSettingsView = {
  offlineMakerChecker: boolean;
  reminderOverdueDays: number | null;
  pendingMakerCheckerRequest: { id: string; reason: string; requestedByMe: boolean; createdAt: string } | null;
};
/** Null when the body is not a settings document (an error, never "default settings"). */
export function mapBillingSettings(p: unknown): BillingSettingsView | null {
  const d = rec(p) && rec(p.data) ? p.data : null;
  if (!d || typeof d.offlineMakerChecker !== "boolean") return null;
  const pr = rec(d.pendingMakerCheckerRequest) ? d.pendingMakerCheckerRequest : null;
  return {
    offlineMakerChecker: d.offlineMakerChecker,
    reminderOverdueDays: typeof d.reminderOverdueDays === "number" ? d.reminderOverdueDays : null,
    pendingMakerCheckerRequest: pr ? { id: str(pr.id), reason: str(pr.reason), requestedByMe: pr.requestedByMe === true, createdAt: str(pr.createdAt) } : null,
  };
}

/** "" -> off (null); a whole number 1..365 -> days; anything else -> undefined (invalid). */
export function parseReminderDays(input: string): number | null | undefined {
  const t = input.trim();
  if (t === "") return null;
  if (!/^\d{1,3}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= 365 ? n : undefined;
}

const REFERENCE_RE: Record<OfflineMode, RegExp> = {
  neft: /^[A-Z]{4}[A-Z0-9]{12}$/, rtgs: /^[A-Z]{4}[A-Z0-9]{18}$/, cheque: /^\d{6}$/, dd: /^\d{6,12}$/,
};
export const normaliseReference = (raw: string): string => raw.replace(/\s+/g, "").toUpperCase();

export type OfflineFormValues = { mode: OfflineMode; reference: string; paidOn: string; reason: string };
export type OfflineFormErrors = Partial<Record<keyof OfflineFormValues, "reference" | "paidOnRequired" | "paidOnFuture" | "paidOnBefore" | "reasonShort">>;

/** Field problems, as catalogue keys (the dialog turns them into en/hi text). `today` and `invoiceDate` are YYYY-MM-DD. */
export function validateOfflineForm(v: OfflineFormValues, today: string, invoiceDate: string): OfflineFormErrors {
  const e: OfflineFormErrors = {};
  if (!REFERENCE_RE[v.mode].test(normaliseReference(v.reference))) e.reference = "reference";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.paidOn)) e.paidOn = "paidOnRequired";
  else if (v.paidOn > today) e.paidOn = "paidOnFuture";
  else if (v.paidOn < invoiceDate) e.paidOn = "paidOnBefore";
  if (v.reason.trim().length < 3) e.reason = "reasonShort";
  return e;
}

/** Today's date in India, YYYY-MM-DD (the office calendar, matching the server rule). */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Settleable = unpaid and live. Gateway-paid, cancelled, waived and draft invoices get no offline controls. */
export const isSettleableStatus = (status: string): boolean => ["issued", "partially_paid", "overdue"].includes(status);

/** Maps a billing-service error code to the catalogue key of its plain-language message. */
export function opsErrorKey(status: number, code: unknown): string {
  switch (code) {
    case "ALREADY_OFF": case "MAKER_CHECKER_VIOLATION": case "DUPLICATE_REFERENCE": case "PENDING_EXISTS": case "INVOICE_NOT_PAYABLE":
    case "NOT_PENDING": case "NO_RECIPIENTS": case "RECIPIENTS_UNAVAILABLE": case "REMINDER_RATE_LIMITED": case "NOTHING_DUE":
      return `err_${String(code)}`;
    default:
      return status === 403 ? "err_FORBIDDEN" : status === 422 || status === 400 ? "err_VALIDATION" : "err_GENERIC";
  }
}
