import { formatIndianDate } from "@/lib/formatters";
import { defaultRecordT, type RecordT } from "./messages";

/**
 * UX-R5 / DS-3 (status-aware actions): the shared core every record module uses to decide which actions fit a
 * record status. Each module declares its rule in lib/records/status/<module>.ts, mirroring the source service
 * state machine (the server stays the final authority and still refuses an invalid transition); pages ask
 * these helpers instead of rendering every button for every status.
 *
 * The rule of thumb from redesign R5: an approved, closed, dropped or terminated record shows its OUTCOME
 * ("Approved by N. Gupta, DDO on 30 Oct 2026"), never "Raise for approval" or other lifecycle actions.
 */

export type StatusRule = {
  /** Statuses after which nothing further can happen to the record (approved, closed, dropped, terminated ...). */
  terminal: readonly string[];
  /**
   * Statuses in which the record may be raised to eOffice for approval. Omitted = every non-terminal status
   * that is not already awaiting a decision (see `awaiting`).
   */
  raisable?: readonly string[];
  /** Statuses that mean a decision is already in flight (pending approval / submitted / under review). */
  awaiting?: readonly string[];
};

/** "Pending Approval" / "pending-approval" / " PENDING_APPROVAL " -> "pending_approval". */
export function normStatus(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isTerminalStatus(rule: StatusRule, status: string | null | undefined): boolean {
  return rule.terminal.includes(normStatus(status));
}

export function isAwaitingDecision(rule: StatusRule, status: string | null | undefined): boolean {
  return (rule.awaiting ?? []).includes(normStatus(status));
}

/** May an officer raise this record for (eOffice) approval in its current status? */
export function canRaiseForApproval(rule: StatusRule, status: string | null | undefined): boolean {
  const s = normStatus(status);
  if (!s) return false;
  if (rule.raisable) return rule.raisable.includes(s);
  return !rule.terminal.includes(s) && !(rule.awaiting ?? []).includes(s);
}

/** Statuses that read as a named outcome verb (recordUi `outcomeVerb.<code>`). */
const OUTCOME_CODES = new Set([
  "approved", "sanctioned", "rejected", "cancelled", "closed", "completed", "terminated", "dropped", "withdrawn",
  "expired", "paid", "passed", "disposed", "condemned", "written_off", "converted", "fulfilled", "issued",
  "penalty_imposed", "exonerated", "finalised",
]);
const OUTCOME_ALIAS: Record<string, string> = { canceled: "cancelled", finalized: "finalised" };

function sentenceCase(code: string): string {
  return code ? code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " ") : "";
}

/** The outcome verb for a status code in the request locale; an unlisted code reads sentence-cased. */
export function outcomeVerb(status: string | null | undefined, t: RecordT = defaultRecordT): string {
  const raw = normStatus(status);
  const s = OUTCOME_ALIAS[raw] ?? raw;
  if (!s) return t("outcomeVerb.closed");
  return OUTCOME_CODES.has(s) ? t(`outcomeVerb.${s}`) : sentenceCase(s);
}

/**
 * The outcome sentence shown in place of lifecycle actions on a finished record:
 * "Approved by N. Gupta, DDO on 30 Oct 2026". Parts that are unknown are left out (never invented).
 */
export function outcomeLine(
  args: { status: string | null | undefined; by?: string | null; at?: string | null },
  t: RecordT = defaultRecordT,
): string {
  const status = outcomeVerb(args.status, t);
  const by = args.by && args.by.trim() && args.by.trim() !== "—" ? args.by.trim() : "";
  const date = args.at ? formatIndianDate(args.at) : "";
  const on = date && date !== "—" ? date : "";
  if (by && on) return t("outcomeByOn", { status, by, date: on });
  if (by) return t("outcomeBy", { status, by });
  if (on) return t("outcomeOn", { status, date: on });
  return t("outcome", { status });
}

/** Why the approval action is not offered, for the disabled-state reason line. */
export function raiseBlockedReason(
  rule: StatusRule,
  status: string | null | undefined,
  statusLabel?: string,
  t: RecordT = defaultRecordT,
): string | null {
  if (canRaiseForApproval(rule, status)) return null;
  const label = statusLabel ?? (normStatus(status).replace(/_/g, " ") || t("thisStatus"));
  if (isAwaitingDecision(rule, status)) return t("raiseAwaiting", { status: label });
  return t("raiseBlocked", { status: label });
}
