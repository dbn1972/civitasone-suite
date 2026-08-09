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

export function calculateRiskScore(complaintCount: number, daysSinceLastComplaint: number): number {
  let score = Math.min(50, complaintCount * 5);
  if (daysSinceLastComplaint <= 7) score += 30;
  else if (daysSinceLastComplaint <= 30) score += 20;
  else if (daysSinceLastComplaint <= 90) score += 10;
  return Math.min(100, score);
}
