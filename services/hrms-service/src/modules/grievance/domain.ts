/**
 * Grievance register domain rules (GAP-HR-GRIEVANCE-01/03/06). Pure, no I/O.
 *
 * State machine (the single source of truth; the web page mirrors the status
 * list and a contract test keeps the two in step):
 *
 *   registered --assign--> under_inquiry --assign (re-assign)--> under_inquiry
 *   registered | under_inquiry --dispose--> disposed   (terminal)
 */

export const GRIEVANCE_STATUSES = ["registered", "under_inquiry", "disposed"] as const;
export type GrievanceStatus = (typeof GRIEVANCE_STATUSES)[number];

/** Statuses a case can still be worked on in. */
export const OPEN_STATUSES: readonly GrievanceStatus[] = ["registered", "under_inquiry"];

/**
 * COARSE category codes only. The list endpoint returns just the code; the
 * free-text subject/description is detail-only (DPDP: a category can reveal
 * health / caste context).
 *
 * There is deliberately NO "harassment" category: sexual-harassment complaints
 * must go to the Internal Committee (POSH Act, 2013; see the ICC module), not
 * to a general grievance register an HR officer could triage or dismiss.
 */
export const GRIEVANCE_CATEGORIES = [
  "workplace_conduct", "pay_allowances", "leave_attendance", "transfer_posting",
  "promotion_service", "facilities", "other",
] as const;
export type GrievanceCategory = (typeof GRIEVANCE_CATEGORIES)[number];

export const GRIEVANCE_DISPOSITIONS = ["resolved", "not_substantiated", "referred", "withdrawn"] as const;
export type GrievanceDisposition = (typeof GRIEVANCE_DISPOSITIONS)[number];

/** Year of a timestamp in Indian Standard Time (the register's calendar). */
export function istYear(at: Date): number {
  return new Date(at.getTime() + 5.5 * 3600_000).getUTCFullYear();
}

/** GRV/YYYY/NNNN (NNNN zero-padded to 4; grows past 9999 without truncating). */
export function formatCaseNo(year: number, seq: number): string {
  return `GRV/${year}/${String(seq).padStart(4, "0")}`;
}

/** Today in IST as YYYY-MM-DD. */
export function istToday(at: Date = new Date()): string {
  return new Date(at.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function canAssign(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}
export function canDispose(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

export interface GrievanceCounts {
  total: number;
  /** registered (not yet taken up) */
  open: number;
  underInquiry: number;
  disposed: number;
}

/** Roll a status->count map up into the register's stat cards (reconciles to total). */
export function countsFromStatusMap(byStatus: Record<string, number>): GrievanceCounts {
  const underInquiry = byStatus["under_inquiry"] ?? 0;
  const disposed = byStatus["disposed"] ?? 0;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  // Anything that is neither under inquiry nor disposed counts as open, so the
  // three buckets always sum to the total.
  return { total, open: total - underInquiry - disposed, underInquiry, disposed };
}
