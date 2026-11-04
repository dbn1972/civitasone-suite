import { formatIndianDate } from "@/lib/formatters";

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

const OUTCOME_VERB: Record<string, string> = {
  approved: "Approved",
  sanctioned: "Sanctioned",
  rejected: "Rejected",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  closed: "Closed",
  completed: "Completed",
  terminated: "Terminated",
  dropped: "Dropped",
  withdrawn: "Withdrawn",
  expired: "Expired",
  paid: "Paid",
  passed: "Passed",
  disposed: "Disposed",
  condemned: "Condemned",
  written_off: "Written off",
  converted: "Converted to purchase order",
  fulfilled: "Fulfilled",
  issued: "Issued",
  penalty_imposed: "Penalty imposed",
  exonerated: "Exonerated",
  finalised: "Finalised",
  finalized: "Finalised",
};

/**
 * The outcome sentence shown in place of lifecycle actions on a finished record:
 * "Approved by N. Gupta, DDO on 30 Oct 2026". Parts that are unknown are left out (never invented).
 */
export function outcomeLine(args: { status: string | null | undefined; by?: string | null; at?: string | null }): string {
  const s = normStatus(args.status);
  const verb = OUTCOME_VERB[s] ?? (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "Closed");
  const by = args.by && args.by.trim() && args.by.trim() !== "—" ? ` by ${args.by.trim()}` : "";
  const date = args.at ? formatIndianDate(args.at) : "";
  const on = date && date !== "—" ? ` on ${date}` : "";
  return `${verb}${by}${on}.`;
}

/** Why the approval action is not offered, for the disabled-state reason line. */
export function raiseBlockedReason(rule: StatusRule, status: string | null | undefined, statusLabel?: string): string | null {
  if (canRaiseForApproval(rule, status)) return null;
  const label = statusLabel ?? (normStatus(status).replace(/_/g, " ") || "this status");
  if (isAwaitingDecision(rule, status)) return `This record is already awaiting a decision (${label}).`;
  return `No approval can be raised for a record that is ${label}.`;
}
