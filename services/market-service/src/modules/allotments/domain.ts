export const ALLOTMENT_TYPES = ["draw", "auction", "committee", "direct"] as const;
export type AllotmentType = (typeof ALLOTMENT_TYPES)[number];

export const ALLOTMENT_STATUSES = [
  "applied",
  "selected",
  "agreement_signed",
  "active",
  "transferred",
  "cancelled",
  "evicted",
] as const;
export type AllotmentStatus = (typeof ALLOTMENT_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, AllotmentStatus[]> = {
  applied: ["selected", "cancelled"],
  selected: ["agreement_signed", "cancelled"],
  agreement_signed: ["active", "cancelled"],
  active: ["transferred", "cancelled", "evicted"],
  transferred: [],
  cancelled: [],
  evicted: [],
};

export function canTransition(from: string, to: AllotmentStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Was defined (canTransition) but never called anywhere in this module —
 * repo.updateStatus had no current-status guard in its WHERE clause, so two
 * concurrent/duplicate commands could both pass a route-level pre-check and
 * both apply, the second silently overwriting the first. Derived from the
 * same VALID_TRANSITIONS table so it can't drift from canTransition.
 */
export function fromStatusesFor(to: AllotmentStatus): AllotmentStatus[] {
  return (Object.keys(VALID_TRANSITIONS) as AllotmentStatus[]).filter((from) =>
    (VALID_TRANSITIONS[from] ?? []).includes(to),
  );
}

/**
 * No command in this module ever sets status="active" — the domain model's own
 * VALID_TRANSITIONS says transfer/cancellation/eviction apply to an "active"
 * allotment, but that status is unreachable given the current feature set
 * (only applied -> selected -> agreement_signed are ever actually set; adding
 * an "activate" step is a separate feature, not built here — flagged in the
 * PR description). lifecycle/consumer.ts uses this constant (rather than
 * fromStatusesFor("transferred"), which would resolve to ["active"] only and
 * therefore never match) so transfer/cancellation/eviction can actually
 * complete against the state allotments really reach.
 */
export const LIFECYCLE_ACTIONABLE_STATUSES: string[] = ["agreement_signed", "active"];

export function generateAllotmentNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `MKT/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
