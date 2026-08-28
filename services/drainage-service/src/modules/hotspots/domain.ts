export type HotspotStatus = "identified" | "action_planned" | "work_in_progress" | "resolved";

const TRANSITIONS: Record<HotspotStatus, HotspotStatus[]> = {
  identified: ["action_planned"],
  action_planned: ["work_in_progress"],
  work_in_progress: ["resolved"],
  resolved: [],
};

export function validateHotspotTransition(from: HotspotStatus, to: HotspotStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

// FLAGGED GAP (not fixed in this pass — see PR description): this function is
// not called from any route or consumer. POST /v1/drainage/hotspots accepts
// complaintCount and riskScore as raw admin-entered integers (see
// hotspots/routes.ts identifyBody) with no server-side derivation from actual
// complaint data, so an admin can currently record any risk score regardless
// of real complaint history for that location. Wiring this up for real would
// need a hotspot-to-complaint linkage that does not exist in the schema today
// (both tables store `location` as a free-form JSON blob with no shared key,
// geohash, or spatial index) — that is a data-model/product decision, not a
// bug fix, and risks being actively worse than the current honestly-manual
// field if an invented proximity heuristic is wrong. Left as manual input
// pending that decision, rather than silently wiring up a guess.
export function calculateRiskScore(complaintCount: number, daysSinceLastComplaint: number): number {
  let score = Math.min(50, complaintCount * 5);
  if (daysSinceLastComplaint <= 7) score += 30;
  else if (daysSinceLastComplaint <= 30) score += 20;
  else if (daysSinceLastComplaint <= 90) score += 10;
  return Math.min(100, score);
}
