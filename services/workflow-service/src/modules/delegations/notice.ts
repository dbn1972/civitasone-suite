import { fetchReportingLine } from "../../shared/hrms-client.js";

export type DelegationNoticeInput = {
  id: string; delegatorId: string; delegateId: string; roles: string[];
  fromDate: string; toDate: string | null;
};

/**
 * Payload of workflow.delegation.created / .revoked. notification-service turns it
 * into a notice for the delegator and (when present) the delegator's manager.
 * `managerId` is null when hrms has no reporting line for the delegator: the
 * delegator is still notified (fail soft).
 */
export function buildDelegationNotice(
  d: DelegationNoticeInput,
  extra: { managerId: string | null; managerName: string | null; delegatorName: string | null; delegateName: string | null },
  now: Date = new Date(),
): Record<string, unknown> {
  return {
    id: d.id, delegatorId: d.delegatorId, delegateId: d.delegateId, roles: d.roles,
    fromDate: d.fromDate, toDate: d.toDate,
    delegatorName: extra.delegatorName, delegateName: extra.delegateName,
    managerId: extra.managerId, managerName: extra.managerName,
    occurredAt: now.toISOString(),
  };
}

/** Looks up names + the delegator's manager from hrms (never throws; fails soft). */
export async function resolveDelegationNotice(tenantId: string, d: DelegationNoticeInput): Promise<Record<string, unknown>> {
  const [delegator, delegate] = await Promise.all([
    fetchReportingLine(tenantId, d.delegatorId),
    fetchReportingLine(tenantId, d.delegateId),
  ]);
  // A manager who is also the delegator or the delegate adds nothing; keep the delegator's own notice only.
  const manager = delegator.manager && delegator.manager.actorId !== d.delegatorId ? delegator.manager : null;
  return buildDelegationNotice(d, {
    managerId: manager?.actorId ?? null, managerName: manager?.fullName || null,
    delegatorName: delegator.fullName, delegateName: delegate.fullName,
  });
}
