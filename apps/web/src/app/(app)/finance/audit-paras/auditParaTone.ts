/**
 * GAP-FINANCE-AUDIT-PARAS-01: audit-register status -> pill tone.
 *
 * The global StatusPill map treats "open" as green ("good") because that is
 * right for most modules; on an audit register an open CAG objection is the
 * unresolved item and must NOT look approved. Statuses are the DB CHECK's
 * open|responded|settled|escalated|dropped.
 */
export type AuditParaTone = "good" | "warn" | "mut" | "bad" | "info";

const TONES: Record<string, AuditParaTone> = {
  open: "bad",
  escalated: "bad",
  responded: "warn",
  settled: "good",
  dropped: "mut",
};

export function auditParaTone(status: string): AuditParaTone {
  return TONES[status.trim().toLowerCase()] ?? "info";
}
