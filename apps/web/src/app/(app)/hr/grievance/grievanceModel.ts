/**
 * Grievance register constants shared by the list, detail and form (GAP-HR-GRIEVANCE-01/02/03/06).
 *
 * The lists below MIRROR services/hrms-service/src/modules/grievance/domain.ts
 * (GRIEVANCE_STATUSES / GRIEVANCE_CATEGORIES / GRIEVANCE_DISPOSITIONS) -- the
 * web app cannot import across the service boundary, so
 * grievanceModel.test.ts reads that file and fails if the two drift.
 */

/** Same set as the backend's GRIEVANCE_ROLES (grievance/routes.ts). */
export const GRIEVANCE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export const GRIEVANCE_STATUSES = ["registered", "under_inquiry", "disposed"] as const;
export type GrievanceStatus = (typeof GRIEVANCE_STATUSES)[number];

export const GRIEVANCE_CATEGORIES = [
  "workplace_conduct", "pay_allowances", "leave_attendance", "transfer_posting",
  "promotion_service", "facilities", "other",
] as const;

export const GRIEVANCE_DISPOSITIONS = ["resolved", "not_substantiated", "referred", "withdrawn"] as const;

export interface GrievanceCounts {
  total: number;
  open: number;
  underInquiry: number;
  disposed: number;
}

export const EMPTY_COUNTS: GrievanceCounts = { total: 0, open: 0, underInquiry: 0, disposed: 0 };

/** Server batch size for the register list. */
export const PAGE_SIZE = 50;

export function isOpenStatus(status: string): boolean {
  return status !== "disposed";
}
