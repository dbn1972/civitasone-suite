/**
 * SVC-121 — training administration: pure, DB-free domain logic.
 * Deterministic so it is fully unit-testable in isolation; all IO (ids, clock,
 * DB) is done in the repo/route layer and results passed in.
 */

/** Maker-checker: an approver must differ from the nominator. */
export function canApprove(nominatedBy: string | null, approverId: string): boolean {
  return nominatedBy !== null && nominatedBy !== approverId;
}

export type ApprovalOutcome = "approved" | "waitlisted";

/**
 * Decide whether an approval takes a seat or joins the waitlist, given the
 * session capacity and how many nominations are already approved for it.
 * When capacity is reached (or exceeded), the nominee is waitlisted.
 */
export function decideApproval(capacity: number, approvedCount: number): ApprovalOutcome {
  return approvedCount < capacity ? "approved" : "waitlisted";
}

/** Next 1-based waitlist position given the current number of waitlisted rows. */
export function nextWaitlistPosition(currentWaitlisted: number): number {
  return currentWaitlisted + 1;
}

/**
 * When a seat frees (an approved nomination is rejected/cancelled), decide who
 * to promote: the waitlisted nomination with the smallest position. Returns the
 * id to promote, or null when the waitlist is empty.
 */
export function pickPromotion(
  waitlisted: Array<{ id: string; waitlistPosition: number | null }>,
): string | null {
  if (waitlisted.length === 0) return null;
  const sorted = [...waitlisted].sort(
    (a, b) => (a.waitlistPosition ?? Number.MAX_SAFE_INTEGER) - (b.waitlistPosition ?? Number.MAX_SAFE_INTEGER),
  );
  return sorted[0]!.id;
}

export interface AttendanceRecord { status: string }

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  excused: number;
  attendanceRate: number; // present / total, 0..1, rounded to 2dp
}

/** Summarise a session's attendance rows. */
export function summariseAttendance(records: AttendanceRecord[]): AttendanceSummary {
  const total = records.length;
  let present = 0, absent = 0, excused = 0;
  for (const r of records) {
    if (r.status === "present") present++;
    else if (r.status === "absent") absent++;
    else if (r.status === "excused") excused++;
  }
  const attendanceRate = total === 0 ? 0 : Math.round((present / total) * 100) / 100;
  return { total, present, absent, excused, attendanceRate };
}
