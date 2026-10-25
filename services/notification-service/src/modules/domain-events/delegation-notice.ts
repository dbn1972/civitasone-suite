/**
 * workflow.delegation.created / .revoked -> notices for the delegator and the
 * delegator's manager (when hrms has a reporting line; the workflow-service
 * producer resolves it fail-soft and sends `managerId: null` when none).
 *
 * Per recipient: an in-app notice. No email is planned: the event carries actor
 * UUIDs, not addresses, and the email adapter needs a real `to` address.
 * Dates are rendered in IST (Asia/Kolkata). The delegation date range is a
 * calendar-date range, the revoke time an instant.
 */
import { SYSTEM_TEMPLATE_IDS } from "@civitasone/events";

export const DELEGATION_CREATED = "workflow.delegation.created";
export const DELEGATION_REVOKED = "workflow.delegation.revoked";

export type DelegationEventPayload = {
  id?: string;
  delegatorId?: string; delegatorName?: string | null;
  delegateId?: string; delegateName?: string | null;
  managerId?: string | null; managerName?: string | null;
  roles?: string[]; fromDate?: string; toDate?: string | null; occurredAt?: string;
};

export type PlannedSend = { channel: "in_app" | "email"; templateId: string };
export type DelegationRecipient = {
  recipientId: string; recipient: string; variables: Record<string, string>; sends: PlannedSend[];
};

const DATE_FMT = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

/** "2026-10-25" (an IST calendar date) -> "25 Oct 2026". Unparseable input is returned as-is. */
export function formatIstDate(d: string): string {
  const t = new Date(`${d}T00:00:00+05:30`);
  return Number.isNaN(t.getTime()) ? d : DATE_FMT.format(t);
}

export function formatIstInstant(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : DATETIME_FMT.format(t);
}

export function formatPeriod(from?: string, to?: string | null): string {
  const f = from ? formatIstDate(from) : "";
  return to ? `${f} to ${formatIstDate(to)}` : `from ${f} until revoked`;
}

export function resolveDelegationRecipients(eventType: string, p: DelegationEventPayload): DelegationRecipient[] {
  const created = eventType === DELEGATION_CREATED;
  if (!p.delegatorId) return [];
  const sends: PlannedSend[] = [
    { channel: "in_app", templateId: created ? SYSTEM_TEMPLATE_IDS.workflowDelegationCreated : SYSTEM_TEMPLATE_IDS.workflowDelegationRevoked },
  ];
  const delegatorName = p.delegatorName || "a colleague";
  const common = {
    roles: (p.roles ?? []).join(", ") || "(none)",
    delegateName: p.delegateName || p.delegateId || "a colleague",
    period: formatPeriod(p.fromDate, p.toDate),
    occurredAt: p.occurredAt ? formatIstInstant(p.occurredAt) : "",
  };
  const verb = created ? "delegated" : "revoked";
  const out: DelegationRecipient[] = [{
    recipientId: p.delegatorId, recipient: p.delegatorId, sends,
    variables: { ...common, headline: created ? "You delegated" : "You revoked" },
  }];
  // No manager found (or the manager is the delegator): the delegator is still notified.
  if (p.managerId && p.managerId !== p.delegatorId) {
    out.push({
      recipientId: p.managerId, recipient: p.managerId, sends,
      variables: { ...common, headline: `${delegatorName} ${verb}` },
    });
  }
  return out;
}
