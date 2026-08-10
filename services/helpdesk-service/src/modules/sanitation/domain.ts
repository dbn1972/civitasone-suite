/**
 * Sanitation (BRD 5.13 SAN-001..004) — pure domain logic.
 *
 * Covers:
 *  - complaint number generation
 *  - complaint status state machine with valid transitions
 *  - severity calculation based on complaint type + location
 *  - reopen eligibility (within 48h of resolution, max 3 reopens)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type ComplaintType =
  | "unclean_toilet"
  | "overflowing_bin"
  | "no_water"
  | "broken_fixture"
  | "foul_odour"
  | "illegal_dumping";

export const COMPLAINT_TYPES: ComplaintType[] = [
  "unclean_toilet",
  "overflowing_bin",
  "no_water",
  "broken_fixture",
  "foul_odour",
  "illegal_dumping",
];

export type Severity = "low" | "medium" | "high" | "critical";

export type ComplaintStatus =
  | "reported"
  | "acknowledged"
  | "assigned"
  | "in_progress"
  | "resolved"
  | "closed"
  | "reopened";

export type ActionType =
  | "inspection"
  | "cleaning"
  | "repair"
  | "replacement"
  | "escalation";

export const ACTION_TYPES: ActionType[] = [
  "inspection",
  "cleaning",
  "repair",
  "replacement",
  "escalation",
];

// ── Complaint number generation ───────────────────────────────────────────────

let _seq = 0;

/** Generate a unique complaint number: SAN-YYYYMMDD-XXXX */
export function generateComplaintNumber(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  _seq = (_seq + 1) % 10000;
  const seq = String(_seq).padStart(4, "0");
  return `SAN-${y}${m}${d}-${seq}`;
}

// ── Status state machine ──────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  reported: ["acknowledged"],
  acknowledged: ["assigned"],
  assigned: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["closed", "reopened"],
  closed: [],
  reopened: ["acknowledged", "assigned", "in_progress"],
};

export { VALID_TRANSITIONS };

export function canTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

// ── Severity calculation ──────────────────────────────────────────────────────

/** High-severity types that warrant elevated initial severity. */
const HIGH_SEVERITY_TYPES: ComplaintType[] = ["illegal_dumping", "overflowing_bin"];
const CRITICAL_TYPES: ComplaintType[] = ["illegal_dumping"];

/**
 * Calculate severity based on complaint type and whether it is near a
 * sensitive zone (hospital, school, market).
 */
export function calculateSeverity(
  type: ComplaintType,
  sensitiveZone: boolean = false,
): Severity {
  if (CRITICAL_TYPES.includes(type) && sensitiveZone) return "critical";
  if (CRITICAL_TYPES.includes(type)) return "high";
  if (HIGH_SEVERITY_TYPES.includes(type)) return sensitiveZone ? "high" : "medium";
  return sensitiveZone ? "medium" : "low";
}

// ── Reopen eligibility ────────────────────────────────────────────────────────

const REOPEN_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours
const MAX_REOPENS = 3;

/**
 * A complaint can be reopened only if:
 *  1. Current status is "resolved"
 *  2. It is within 48 hours of resolution
 *  3. reopenCount < 3
 */
export function canReopen(
  status: ComplaintStatus,
  resolvedAt: Date | null,
  reopenCount: number,
  now: Date = new Date(),
): boolean {
  if (status !== "resolved") return false;
  if (reopenCount >= MAX_REOPENS) return false;
  if (!resolvedAt) return false;
  return now.getTime() - resolvedAt.getTime() <= REOPEN_WINDOW_MS;
}
