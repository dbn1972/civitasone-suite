/**
 * Record-UI messages (UX-R5): the translator the shared record helpers (labels, statusActions, indianDate) and
 * the ds components (RecordHeader, ApprovalTrail, RequiredLegend, Field) read their wording from, so every page
 * that uses them is bilingual by default. Keys live in messages/{en,hi}.json under `recordUi`.
 *
 * Pure helpers take an optional `RecordT`; without one they use RECORD_UI_EN (English), which a parity test keeps
 * equal to en.json `recordUi`. Components call `useRecordT()`; server pages call `getRecordT()`
 * (messages.server.ts) and hand the translator to the helpers.
 */
import { useTranslations } from "next-intl";

export interface RecordT {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

/** The English wording the pure helpers fall back to. Mirrors en.json `recordUi` (see messages.test.ts). */
export const RECORD_UI_EN: Readonly<Record<string, string>> = {
  unresolved: "Name not available (ID ending {tail})",
  thisStatus: "this status",
  "outcomeVerb.approved": "Approved",
  "outcomeVerb.sanctioned": "Sanctioned",
  "outcomeVerb.rejected": "Rejected",
  "outcomeVerb.cancelled": "Cancelled",
  "outcomeVerb.closed": "Closed",
  "outcomeVerb.completed": "Completed",
  "outcomeVerb.terminated": "Terminated",
  "outcomeVerb.dropped": "Dropped",
  "outcomeVerb.withdrawn": "Withdrawn",
  "outcomeVerb.expired": "Expired",
  "outcomeVerb.paid": "Paid",
  "outcomeVerb.passed": "Passed",
  "outcomeVerb.disposed": "Disposed",
  "outcomeVerb.condemned": "Condemned",
  "outcomeVerb.written_off": "Written off",
  "outcomeVerb.converted": "Converted to purchase order",
  "outcomeVerb.fulfilled": "Fulfilled",
  "outcomeVerb.issued": "Issued",
  "outcomeVerb.penalty_imposed": "Penalty imposed",
  "outcomeVerb.exonerated": "Exonerated",
  "outcomeVerb.finalised": "Finalised",
  outcome: "{status}.",
  outcomeBy: "{status} by {by}.",
  outcomeOn: "{status} on {date}.",
  outcomeByOn: "{status} by {by} on {date}.",
  raiseAwaiting: "This record is already awaiting a decision ({status}).",
  raiseBlocked: "No approval can be raised for a record that is {status}.",
  fieldRequired: "{label} is required.",
  fieldRequiredGeneric: "This field is required.",
  dateLabel: "Date",
  dateEnter: "Enter the {label} as DD-MM-YYYY.",
  dateNotReal: "{value} is not a real date. Check the day and month.",
  dateFormat: "Enter the {label} as DD-MM-YYYY, for example 04-11-2026.",
  dateBefore: "{label} cannot be before {date}.",
  dateAfter: "{label} cannot be after {date}.",
  "action.created": "Created",
  "action.submitted": "Submitted",
  "action.approved": "Approved",
  "action.rejected": "Rejected",
  "action.returned": "Returned for correction",
  "action.forwarded": "Forwarded",
  "action.claimed": "Taken up",
  "action.cancelled": "Cancelled",
  "action.closed": "Closed",
  "action.lodged": "Lodged",
  "action.raised": "Raised",
  "action.passed_for_payment": "Passed for payment",
};

function interpolate(template: string, values?: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (values && k in values ? String(values[k]) : m));
}

/** English translator used when no RecordT is supplied (unit tests, scripts). */
export const defaultRecordT: RecordT = Object.assign(
  (key: string, values?: Record<string, string | number>) => interpolate(RECORD_UI_EN[key] ?? key, values),
  { has: (key: string) => key in RECORD_UI_EN },
);

/** Adapt a next-intl translator (namespace `recordUi`) to the loose RecordT shape. */
export function asRecordT(t: unknown): RecordT {
  return t as RecordT;
}

/** Component hook (client or server component): the `recordUi` translator. */
export function useRecordT(): RecordT {
  return asRecordT(useTranslations("recordUi"));
}
