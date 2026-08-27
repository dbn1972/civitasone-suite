export const DEMAND_STATUSES = ["generated", "sent", "paid", "overdue", "waived"] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

// No transition table existed for this module at all — repo.updateStatus had
// no current-status guard, so a double-submit pay+waive race on the same
// demand could both succeed, one silently overwriting the other. "sent" and
// "overdue" are modeled but never assigned anywhere in this service (no
// scheduler/cron exists to mark a demand overdue past its due date) — both
// stay reachable here for forward-compatibility, but building that automation
// is a separate feature, flagged in the PR description, not built here.
const VALID_TRANSITIONS: Record<string, DemandStatus[]> = {
  generated: ["sent", "paid", "overdue", "waived"],
  sent: ["paid", "overdue", "waived"],
  overdue: ["paid", "waived"],
  paid: [],
  waived: [],
};

export function canTransition(from: string, to: DemandStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export function fromStatusesFor(to: DemandStatus): DemandStatus[] {
  return (Object.keys(VALID_TRANSITIONS) as DemandStatus[]).filter((from) =>
    (VALID_TRANSITIONS[from] ?? []).includes(to),
  );
}
