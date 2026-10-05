/**
 * GAP-CRM-RTI-01: shared RTI status / SLA helpers.
 *
 * The RTI register's SLA signalling must agree with its status. A request
 * that has been RESPONDED, REJECTED or DISPOSED is no longer running against
 * the 30-day statutory clock -- it must NOT be counted as "overdue" nor show
 * a red "N d overdue" badge, which would read as an ongoing statutory breach
 * for a request that is in fact closed. Only genuinely open requests
 * (RECEIVED, TRANSFERRED, FIRST_APPEAL, SECOND_APPEAL) are still live against
 * the deadline.
 *
 * Centralised here so the Overdue / Critical / Open tile counts (page.tsx)
 * and the per-row SlaBadge (RtiTable.tsx) can never disagree about what
 * "closed" means -- the exact inconsistency the gap describes.
 */

/**
 * Statuses that are terminal for SLA purposes: the statutory response clock no
 * longer applies. RESPONDED and DISPOSED are plainly closed; REJECTED is a
 * recorded, final decision on the request too (the applicant's remedy is the
 * appeal chain, which is tracked by its own first-appeal deadline, not this
 * request's response due date).
 */
const RTI_CLOSED_STATUSES = new Set(["RESPONDED", "REJECTED", "DISPOSED"]);

/** True when the request is no longer running against the 30-day response SLA. */
export function isRtiClosed(status: string | null | undefined): boolean {
  return RTI_CLOSED_STATUSES.has((status ?? "").toUpperCase());
}

/**
 * Whole calendar days until `dueAt` (an ISO instant), in Asia/Kolkata, or
 * null when there is no due date. Negative = overdue. Shared by the tile
 * counts and the badge so both bucket a row identically.
 *
 * This mirrors formatters.daysUntilIST's IST calendar-day arithmetic rather
 * than the previous `Math.ceil(ms / 86_400_000)` which silently shifted by a
 * day depending on the time of day the page rendered and lost the IST day
 * boundary. We inline the IST-offset calc here (not import daysUntilIST) only
 * because dueAt is always a full timestamp, never a bare calendar date.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function rtiDaysLeft(dueAt: string | null | undefined): number | null {
  if (!dueAt) return null;
  const parsed = new Date(dueAt);
  if (isNaN(parsed.getTime())) return null;
  const targetDateOnly = new Date(parsed.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const todayDateOnly = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const targetMs = new Date(`${targetDateOnly}T00:00:00.000Z`).getTime();
  const todayMs = new Date(`${todayDateOnly}T00:00:00.000Z`).getTime();
  return Math.round((targetMs - todayMs) / 86_400_000);
}

/**
 * SLA bucket for a row, honouring status. A closed request is always
 * "closed" regardless of its (now historic) due date; only an open request
 * is bucketed by its remaining days.
 */
export type RtiSlaBucket = "closed" | "overdue" | "critical" | "due";

export function rtiSlaBucket(
  status: string | null | undefined,
  dueAt: string | null | undefined,
): RtiSlaBucket {
  if (isRtiClosed(status)) return "closed";
  const days = rtiDaysLeft(dueAt);
  if (days === null) return "due";
  if (days < 0) return "overdue";
  if (days < 7) return "critical";
  return "due";
}
