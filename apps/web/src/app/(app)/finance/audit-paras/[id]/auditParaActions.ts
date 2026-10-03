import { AUDIT_PARA_ACT_ROLES, AUDIT_PARA_SETTLE_ROLES, canWrite } from "@/lib/finance/writeRoles";

export type ParaAction = "respond" | "escalate" | "settle";

/**
 * Which workflow actions to OFFER for an audit para (GAP-FINANCE-AUDIT-PARAS-DETAIL-04). Mirrors the
 * finance-service state machine (respond: open|escalated, escalate: open|responded, settle: responded)
 * and its role split (reply/escalate: finance roles, settle: admins only). The server stays the
 * authority; this only avoids offering a control that would 409 / 403.
 */
export function availableParaActions(status: string | null | undefined, sessionRoles: readonly string[]): ParaAction[] {
  const s = (status ?? "").trim().toLowerCase();
  const out: ParaAction[] = [];
  if (canWrite(sessionRoles, AUDIT_PARA_ACT_ROLES)) {
    if (s === "open" || s === "escalated") out.push("respond");
    if (s === "open" || s === "responded") out.push("escalate");
  }
  if (s === "responded" && canWrite(sessionRoles, AUDIT_PARA_SETTLE_ROLES)) out.push("settle");
  return out;
}

/** True when the para has a recorded reply / escalation / settlement (kept out of page.tsx: the empty-vs-error guard). */
export function hasEvents(events: readonly unknown[]): boolean {
  return events.length > 0;
}
