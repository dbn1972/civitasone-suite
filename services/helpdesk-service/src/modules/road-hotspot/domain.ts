/**
 * Road Hotspot (BRD 5.14 ROAD-004) — pure domain logic.
 *
 * Covers:
 *  - hotspot code generation
 *  - risk score calculation (complaint frequency + severity + road category)
 *  - threshold check for hotspot creation (3+ complaints within 500m in 30 days)
 *  - hotspot status state machine
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type RoadCategory =
  | "pothole"
  | "waterlogging"
  | "cave_in"
  | "surface_damage"
  | "drainage";

export const ROAD_CATEGORIES: RoadCategory[] = [
  "pothole",
  "waterlogging",
  "cave_in",
  "surface_damage",
  "drainage",
];

export type HotspotStatus =
  | "identified"
  | "under_review"
  | "maintenance_planned"
  | "work_in_progress"
  | "resolved";

// ── Hotspot code generation ─────────────────────────────────────────────────

let _seq = 0;

/** Generate a unique hotspot code: RH-YYYYMMDD-XXXX */
export function generateHotspotCode(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  _seq = (_seq + 1) % 10000;
  const seq = String(_seq).padStart(4, "0");
  return `RH-${y}${m}${d}-${seq}`;
}

// ── Status state machine ──────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<HotspotStatus, HotspotStatus[]> = {
  identified: ["under_review"],
  under_review: ["maintenance_planned"],
  maintenance_planned: ["work_in_progress"],
  work_in_progress: ["resolved"],
  resolved: [],
};

export { VALID_TRANSITIONS };

export function canTransition(from: HotspotStatus, to: HotspotStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

// ── Risk score calculation ────────────────────────────────────────────────────

/** Category severity weights (higher = more dangerous). */
const CATEGORY_WEIGHT: Record<RoadCategory, number> = {
  cave_in: 30,
  waterlogging: 25,
  pothole: 20,
  drainage: 15,
  surface_damage: 10,
};

/**
 * Calculate a risk score (0-100) based on:
 *  - complaint frequency (count, capped contribution at 40)
 *  - road category severity weight (0-30)
 *  - recency factor: boost if last complaint is within 7 days (0-30)
 */
export function calculateRiskScore(
  complaintCount: number,
  category: RoadCategory,
  lastComplaintAt: Date | null,
  now: Date = new Date(),
): number {
  // Frequency component: each complaint adds 5 points, capped at 40
  const frequency = Math.min(complaintCount * 5, 40);

  // Category weight component: 0-30
  const catWeight = CATEGORY_WEIGHT[category] ?? 10;

  // Recency component: 30 if within 1 day, linearly decays to 0 at 30 days
  let recency = 0;
  if (lastComplaintAt) {
    const daysSince = (now.getTime() - lastComplaintAt.getTime()) / (1000 * 60 * 60 * 24);
    recency = Math.max(0, Math.round(30 * (1 - daysSince / 30)));
  }

  return Math.min(100, frequency + catWeight + recency);
}

// ── Hotspot creation threshold ────────────────────────────────────────────────

const THRESHOLD_COUNT = 3;
const THRESHOLD_RADIUS_M = 500;
const THRESHOLD_DAYS = 30;

/**
 * Determine whether a cluster of complaints warrants a new hotspot:
 * 3+ complaints within 500m radius in the last 30 days.
 *
 * @param nearbyComplaintCount complaints within 500m in last 30 days
 */
export function shouldCreateHotspot(nearbyComplaintCount: number): boolean {
  return nearbyComplaintCount >= THRESHOLD_COUNT;
}

/**
 * Haversine distance between two lat/lng points in metres.
 * Used by the route/service layer to filter nearby complaints.
 */
export function haversineDistanceM(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
