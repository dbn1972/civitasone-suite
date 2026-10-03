import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { employeeStatusEnum } from "./status.js";

// GET /v1/hrms/employees query params: standard pagination plus an optional
// tenant-scoped employeeType filter (see repo.listByTenant / queries.listEmployees).
// NOTE: also declared verbatim on the employee-detail/id-cards/disciplinary
// cluster branch (PR #753), which touched this file for an unrelated fix
// (basicMinor bigint->number) but happened to carry this hunk along; the two
// insertions are identical so whichever PR merges second should merge cleanly.
export const employeeListQuery = listQuerySchema.extend({
  employeeType: z.string().min(1).max(32).optional(),
  // GAP-HR-EMPLOYEES-06: optional server-side status filter (canonical
  // lowercase EMPLOYEE_STATUSES) -- e.g. ?status=separated lists only separated.
  status: employeeStatusEnum.optional(),
  // GAP-HR-SF-06 (EntityPicker): optional free-text search for the picker's
  // search(q) adapter -- matches fullName/employeeNo (ILIKE, repo.ts), same
  // DIRECTORY_ROLES gate and PII-free response shape as the existing list
  // (see routes.ts's DIRECTORY_ROLES comment / queries.listEmployees).
  q: z.string().trim().min(1).max(100).optional(),
  // GAP-HR-SF-06: optional batch id lookup for the picker's resolve(ids)
  // adapter -- pre-populates an edit form's label for an id it already has
  // (this is the fix for GAP-HR-EMPLOYEES-DETAIL-EDIT-04's blank-on-every-
  // visit pay-structure/manager select). Comma-separated uuids so it works
  // through any querystring parser; capped at 50 so the IN() clause stays
  // bounded.
  ids: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((v) => v.trim()).filter(Boolean) : undefined))
    .refine(
      (arr) => !arr || (arr.length <= 50 && arr.every((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))),
      { message: "ids must be a comma-separated list of up to 50 UUIDs" },
    ),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuery>;

/** GAP-HR-EMPLOYEES-NEW-01: closed value sets for the newly persisted profile fields. */
export const MARITAL_STATUSES = ["single", "married", "divorced", "widowed"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"] as const;
export const SHIFTS = ["general", "morning", "evening", "night"] as const;

export const createEmployeeBody = z.object({
  employeeNo:    z.string().min(1).max(32),
  fullName:      z.string().min(1).max(256),
  departmentId:  z.string().uuid(),
  designationId: z.string().uuid(),
  dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  dateOfBirth:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender:        z.enum(["male", "female", "other"]).optional(),
  pan:           z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "must be a valid PAN (AAAAA9999A)").optional(),
  aadhaarRef:    z.string().optional(),
  mobile:        z.string().max(20).optional(),
  email:         z.string().email().optional(),
  bankAccountNo: z.string().optional(),
  bankIfsc:      z.string().max(16).optional(),
  // Any code; membership (canonical category / tenant type-master / legacy) is
  // enforced at the route via assertKnownEngagementType so tenant-defined types
  // are accepted and typos rejected (a static enum would reject valid tenant codes).
  employeeType:  z.string().min(1).max(32).default("permanent"),
  basicMinor:    z.number().int().nonnegative().default(0),
  currency:      z.string().length(3).default("INR"),
  payStructureId: z.string().uuid().optional(),
  // ERP org-structure refs (cross-service)
  legalEntityId:  z.string().uuid().optional(),
  costCenterId:   z.string().uuid().optional(),
  locationId:     z.string().uuid().optional(),
  // Statutory + engagement-type-specific identifiers (DIC).
  esicIpNumber:   z.string().max(17).optional(),
  uanNumber:      z.string().max(12).optional(),
  pran:           z.string().max(12).optional(),
  gstin:          z.string().max(15).optional(),
  sacCode:        z.string().max(6).optional(),
  agencyRef:      z.string().max(64).optional(),
  napsId:         z.string().max(24).optional(),
  managerId:    z.string().uuid().optional(),
  station:      z.string().max(128).optional(),
  category:     z.enum(["UR", "SC", "ST", "OBC", "EWS"]).optional(),
  disability:   z.boolean().default(false),
  photoDataUrl: z.string().optional(),
  // GAP-HR-EMPLOYEES-NEW-01: previously silently stripped as unknown keys.
  serviceGrade:  z.string().trim().min(1).max(64).optional(),
  maritalStatus: z.enum(MARITAL_STATUSES).optional(),
  bloodGroup:    z.enum(BLOOD_GROUPS).optional(),
  shift:         z.enum(SHIFTS).optional(),
});
export type CreateEmployeeBody = z.infer<typeof createEmployeeBody>;

// GAP-HR-CONFIRMATION-02: a confirmation is a formal service-record event
// (order/authority reference, GFR-style), not just a click-through date --
// orderRef is required so every confirmation is traceable to a real order;
// authority/remark are optional context. confirmationDate bounds (not
// before dateOfJoining, not in the future) are checked at the route, which
// already reads the employee row for the status precheck.
export const confirmEmployeeBody = z.object({
  confirmationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  orderRef: z.string().min(1, "order reference is required").max(64),
  authority: z.string().max(128).optional(),
  remark: z.string().max(500).optional(),
});
export type ConfirmEmployeeBody = z.infer<typeof confirmEmployeeBody>;

// GAP-HR-CONFIRMATION-05: probation-extension record. newEndDate must move
// the probation end *later* than its current value -- checked at the route
// (a DB read the schema alone can't express), not here.
export const probationExtensionBody = z.object({
  newEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  reason:     z.string().min(3, "reason must be at least 3 characters").max(500),
  orderRef:   z.string().max(128).optional(),
});
export type ProbationExtensionBody = z.infer<typeof probationExtensionBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const updateEmployeeBody = z.object({
  mobile:         z.string().max(20).optional(),
  email:          z.string().email().optional(),
  bankAccountNo:  z.string().optional(),
  bankIfsc:       z.string().max(16).optional(),
  // GAP-HR-EMPLOYEES-DETAIL-EDIT-04: basic pay is NOT editable on this generic
  // profile route. It is money that feeds every payslip, and this path has no
  // maker-checker, no effective date and no arrears handling; payroll's salary
  // revision / pay-matrix flows own it (approved, effective-dated, audited).
  // No UI ever sent it, so nothing legitimate breaks; a caller that still does
  // gets an explicit 400 instead of a silent overwrite or a silent drop.
  basicMinor:     z.undefined({ message: "Basic pay cannot be changed here. Use a salary revision in Payroll, which is approved, effective-dated and audited." }).optional(),
  payStructureId: z.string().uuid().optional(),
  managerId:      z.string().uuid().optional(),
  uanNumber:      z.string().max(12).optional(),
  esicIpNumber:   z.string().max(17).optional(),
  pran:           z.string().max(12).optional(),
  gstin:          z.string().max(15).optional(),
  sacCode:        z.string().max(6).optional(),
  agencyRef:      z.string().max(64).optional(),
  napsId:         z.string().max(24).optional(),
  // GAP-HR-EMPLOYEES-NEW-01
  serviceGrade:   z.string().trim().min(1).max(64).optional(),
  maritalStatus:  z.enum(MARITAL_STATUSES).optional(),
  bloodGroup:     z.enum(BLOOD_GROUPS).optional(),
  shift:          z.enum(SHIFTS).optional(),
  costCenterId:   z.string().uuid().optional(),
  // GAP-HR-EMPLOYEES-DETAIL-EDIT-03: required (by routes.ts, not by this
  // schema -- optional here so a non-sensitive edit, e.g. email alone,
  // never needs one) whenever the patch touches bankAccountNo/bankIfsc/
  // uanNumber/esicIpNumber/pran. Never persisted verbatim into hrms_
  // employees itself -- consumed only by the audit trail (employee/
  // consumer.ts).
  reason:         z.string().trim().min(10).max(500).optional(),
});
export type UpdateEmployeeBody = z.infer<typeof updateEmployeeBody>;

// GAP-HR-EMPLOYEES-DETAIL-EDIT-03: shared between routes.ts's synchronous
// pre-check and anything else that needs to know "does this patch change
// something sensitive enough to require a reason".
export const SENSITIVE_UPDATE_FIELDS = ["bankAccountNo", "bankIfsc", "uanNumber", "esicIpNumber", "pran"] as const;

export const employeeQueryParams = z.object({
  empId: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
