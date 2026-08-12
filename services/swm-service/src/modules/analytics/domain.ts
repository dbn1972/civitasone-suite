export type HotspotStatus = "identified" | "action_planned" | "resolved";

const TRANSITIONS: Record<HotspotStatus, HotspotStatus[]> = {
  identified: ["action_planned", "resolved"],
  action_planned: ["resolved"],
  resolved: [],
};

export function validateHotspotTransition(from: HotspotStatus, to: HotspotStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

export function calculateRiskScore(complaintCount: number): number {
  if (complaintCount >= 20) return 100;
  if (complaintCount >= 10) return 75;
  if (complaintCount >= 5) return 50;
  if (complaintCount >= 2) return 25;
  return 10;
}
