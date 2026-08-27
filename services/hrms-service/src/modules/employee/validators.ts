import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";

// GET /v1/hrms/employees query params: standard pagination plus an optional
// tenant-scoped employeeType filter (see repo.listByTenant / queries.listEmployees).
export const employeeListQuery = listQuerySchema.extend({
  employeeType: z.string().min(1).max(32).optional(),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuery>;

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
});
export type CreateEmployeeBody = z.infer<typeof createEmployeeBody>;

export const confirmEmployeeBody = z.object({
  confirmationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
});
export type ConfirmEmployeeBody = z.infer<typeof confirmEmployeeBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const updateEmployeeBody = z.object({
  mobile:         z.string().max(20).optional(),
  email:          z.string().email().optional(),
  bankAccountNo:  z.string().optional(),
  bankIfsc:       z.string().max(16).optional(),
  // HR-A deep-verify finding: this was `z.bigint()`, which can never parse a
  // real HTTP JSON body (JSON has no bigint literal) -- every PATCH that
  // included basicMinor would 400 with "Expected bigint, received number".
  // Match createEmployeeBody's basicMinor type; commands.ts already does
  // `.toString()` on this value, which works the same on a plain number.
  basicMinor:     z.number().int().nonnegative().optional(),
  payStructureId: z.string().uuid().optional(),
  managerId:      z.string().uuid().optional(),
  uanNumber:      z.string().max(12).optional(),
  esicIpNumber:   z.string().max(17).optional(),
  pran:           z.string().max(12).optional(),
  gstin:          z.string().max(15).optional(),
  sacCode:        z.string().max(6).optional(),
  agencyRef:      z.string().max(64).optional(),
  napsId:         z.string().max(24).optional(),
});
export type UpdateEmployeeBody = z.infer<typeof updateEmployeeBody>;

export const employeeQueryParams = z.object({
  empId: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
