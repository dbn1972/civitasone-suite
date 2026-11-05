import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import {
  zTrimmedText, zTrimmedCode, zIsoDate, DATE_WINDOWS, istToday, checkAgeAtJoining, fieldIssue, FIELD_CODES,
  zAadhaarMasked, zIfsc, zUan, zGstin, zIndianMobile, boundedMinorNumber,
} from "@civitasone/schemas/validators";
import { EMPLOYEE_STATUSES, employeeStatusEnum, isEmployeeStatus } from "./status.js";

// GET /v1/hrms/employees query params: standard pagination plus an optional
// tenant-scoped employeeType filter (see repo.listByTenant / queries.listEmployees).
// NOTE: also declared verbatim on the employee-detail/id-cards/disciplinary
// cluster branch (PR #753), which touched this file for an unrelated fix
// (basicMinor bigint->number) but happened to carry this hunk along; the two
// insertions are identical so whichever PR merges second should merge cleanly.
export const employeeListQuery = listQuerySchema.extend({
  // Comma-separated list of engagement types, matched case-insensitively
  // (repo.listByTenant), e.g. ?employeeType=intern,apprentice. Max 8 values.
  employeeType: z.string().min(1).max(200)
    .refine((v) => v.split(",").map((t) => t.trim()).filter(Boolean).length <= 8, { message: "employeeType accepts at most 8 values" })
    .optional(),
  // GAP-HR-EMPLOYEES-06: optional server-side status filter (canonical
  // lowercase EMPLOYEE_STATUSES) -- e.g. ?status=separated lists only separated.
  status: employeeStatusEnum.optional(),
  // GAP-HR-EMPLOYEES-DETAIL-EDIT-05: comma-separated canonical statuses to
  // EXCLUDE (e.g. ?excludeStatuses=terminated,separated,retired), applied in
  // the query itself so a 20-row picker page is never spent on people who
  // cannot be chosen. Unknown values are a 400, not a silent no-op.
  excludeStatuses: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((v) => v.trim()).filter(Boolean) : undefined))
    .refine(
      (arr) => !arr || (arr.length <= EMPLOYEE_STATUSES.length && arr.every((v) => isEmployeeStatus(v))),
      { message: `excludeStatuses must be a comma-separated list of: ${EMPLOYEE_STATUSES.join(", ")}` },
    ),
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

/**
 * ISO 3166-2:IN state / UT codes (plus the legacy codes still in use). Mirrors the list
 * payroll-service accepts for professional-tax states; the two services share no code.
 */
export const WORK_STATE_CODES = [
  "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DH", "DL", "GA", "GJ", "HR", "HP", "JK", "JH", "KA", "KL",
  "LA", "LD", "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "PB", "PY", "RJ", "SK", "TN", "TS", "TR", "UP",
  "UK", "WB", "OR", "DN", "DD", "UT",
] as const;
const workStateCode = z.string().trim().toUpperCase().refine((c) => (WORK_STATE_CODES as readonly string[]).includes(c), "must be an Indian state / UT code, e.g. MH");

// UAT T-EDGE bundle 21 (TE-01 / TE-05 / TE-06 / TE-07): real calendar dates in a plausible
// range, trimmed non-blank name and employee number (so the duplicate check sees the stored
// value), statutory identifiers checked (Aadhaar Verhoeff + stored masked, IFSC, UAN, GSTIN
// checksum, Indian mobile) and basic pay bounded -- all refused here with a field code
// instead of a 500 (impossible dates, 1e19 basic) or a stored bad value.
export const createEmployeeBody = z.object({
  employeeNo:    zTrimmedCode(32, "employee number"),
  fullName:      zTrimmedText(256, { label: "full name" }),
  departmentId:  z.string().uuid(),
  designationId: z.string().uuid(),
  dateOfJoining: zIsoDate({ window: () => DATE_WINDOWS.dateOfJoining(istToday()), label: "date of joining" }),
  dateOfBirth:   zIsoDate({ label: "date of birth" }).optional(),
  gender:        z.enum(["male", "female", "other"]).optional(),
  pan:           z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "must be a valid PAN (AAAAA9999A)").optional(),
  // Full 12-digit Aadhaar (Verhoeff-checked) or the masked form; only the masked form
  // XXXX-XXXX-1234 is stored (the column is also sealed at rest, see schema.ts).
  aadhaarRef:    zAadhaarMasked.optional(),
  mobile:        zIndianMobile.optional(),
  email:         z.string().email().optional(),
  bankAccountNo: z.string().optional(),
  bankIfsc:      zIfsc.optional(),
  // Any code; membership (canonical category / tenant type-master / legacy) is
  // enforced at the route via assertKnownEngagementType so tenant-defined types
  // are accepted and typos rejected (a static enum would reject valid tenant codes).
  employeeType:  z.string().min(1).max(32).default("permanent"),
  basicMinor:    z.number().int().nonnegative().superRefine(boundedMinorNumber).default(0),
  currency:      z.string().length(3).default("INR"),
  payStructureId: z.string().uuid().optional(),
  // ERP org-structure refs (cross-service)
  legalEntityId:  z.string().uuid().optional(),
  costCenterId:   z.string().uuid().optional(),
  locationId:     z.string().uuid().optional(),
  workStateCode:  workStateCode.optional(),
  // Statutory + engagement-type-specific identifiers (DIC).
  esicIpNumber:   z.string().max(17).optional(),
  uanNumber:      zUan.optional(),
  pran:           z.string().max(12).optional(),
  gstin:          zGstin.optional(),
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
}).superRefine((v, ctx) => {
  // TE-07 (E05): a date of birth after the date of joining, or an age outside 18-70 on it.
  if (v.dateOfBirth && v.dateOfJoining) {
    if (v.dateOfBirth >= v.dateOfJoining) {
      fieldIssue(ctx, FIELD_CODES.DATE_ORDER, "date of birth must be before the date of joining", ["dateOfBirth"]);
      return;
    }
    const age = checkAgeAtJoining(v.dateOfBirth, v.dateOfJoining);
    if (age) fieldIssue(ctx, age.code, age.message, ["dateOfBirth"]);
  }
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

/**
 * FQ14: PATCH /v1/hrms/employees/:id/login-link. userId is the login (identity
 * user id or Keycloak sub) to link, or null to unlink; reason is required and
 * lands in the audit event.
 */
export const loginLinkBody = z.object({
  userId: z.string().uuid().nullable(),
  reason: z.string().trim().min(3).max(500),
}).strict();
export type LoginLinkBody = z.infer<typeof loginLinkBody>;

/**
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-02: GET masks mobile / bank account ("******7890"),
 * so a client that echoes a field back -- untouched, or half-edited -- sends
 * asterisks. No genuine phone number, account number or IFSC ever contains one,
 * and persisting it would corrupt the stored value (the account number feeds
 * salary disbursement). Rejected at the boundary with a field-level 400;
 * commands.ts's isMaskedValue guard stays behind this as a backstop.
 */
const noMaskChar = (v: string) => !v.includes("*");
const MASK_CHAR_MESSAGE = "must not contain '*' -- this looks like a masked placeholder, not a real value";

/**
 * EditEmployeeForm sends "" to CLEAR an optional identifier. Blank means "remove it" (stored as NULL);
 * any non-blank value is still fully validated (TE-05), so a bad value stays a 400.
 */
const emptyToNull = (v: unknown): unknown => (typeof v === "string" && v.trim() === "" ? null : v);

export const updateEmployeeBody = z.object({
  mobile:         z.preprocess(emptyToNull, z.string().max(20).refine(noMaskChar, MASK_CHAR_MESSAGE).pipe(zIndianMobile).nullable()).optional(),
  email:          z.string().email().optional(),
  bankAccountNo:  z.string().refine(noMaskChar, MASK_CHAR_MESSAGE).optional(),
  bankIfsc:       z.preprocess(emptyToNull, z.string().max(16).refine(noMaskChar, MASK_CHAR_MESSAGE).pipe(zIfsc).nullable()).optional(),
  // GAP-HR-EMPLOYEES-DETAIL-EDIT-04: basic pay is NOT editable on this generic
  // profile route. It is money that feeds every payslip, and this path has no
  // maker-checker, no effective date and no arrears handling; payroll's salary
  // revision / pay-matrix flows own it (approved, effective-dated, audited).
  // No UI ever sent it, so nothing legitimate breaks; a caller that still does
  // gets an explicit 400 instead of a silent overwrite or a silent drop.
  basicMinor:     z.undefined({ message: "Basic pay cannot be changed here. Use a salary revision in Payroll, which is approved, effective-dated and audited." }).optional(),
  payStructureId: z.string().uuid().optional(),
  managerId:      z.string().uuid().optional(),
  uanNumber:      z.preprocess(emptyToNull, z.string().max(12).refine(noMaskChar, MASK_CHAR_MESSAGE).pipe(zUan).nullable()).optional(),
  esicIpNumber:   z.string().max(17).optional(),
  pran:           z.string().max(12).optional(),
  gstin:          z.string().max(15).refine(noMaskChar, MASK_CHAR_MESSAGE).pipe(zGstin).optional(),
  sacCode:        z.string().max(6).optional(),
  agencyRef:      z.string().max(64).optional(),
  napsId:         z.string().max(24).optional(),
  // GAP-HR-EMPLOYEES-NEW-01
  serviceGrade:   z.string().trim().min(1).max(64).optional(),
  maritalStatus:  z.enum(MARITAL_STATUSES).optional(),
  bloodGroup:     z.enum(BLOOD_GROUPS).optional(),
  shift:          z.enum(SHIFTS).optional(),
  costCenterId:   z.string().uuid().optional(),
  workStateCode:  workStateCode.optional(),
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
