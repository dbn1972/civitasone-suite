import { z } from "zod";
import { USER_STATUSES } from "./domain.js";

export const createUserBody = z.object({
  email:   z.string().email().max(254),
  name:    z.string().min(1).max(200),
  empCode: z.string().max(64).optional(),
});
export type CreateUserBody = z.infer<typeof createUserBody>;

export const updateUserBody = z.object({
  name:    z.string().min(1).max(200).optional(),
  empCode: z.string().max(64).optional(),
}).refine((b) => b.name !== undefined || b.empCode !== undefined, {
  message: "at least one of name, empCode required",
});
export type UpdateUserBody = z.infer<typeof updateUserBody>;

export const statusBody = z.object({
  status: z.enum(USER_STATUSES),
  reason: z.string().min(3).max(500).optional(),
});
export type StatusBody = z.infer<typeof statusBody>;

/**
 * GAP-TENANT-ADMIN-USERS-DETAIL-01/02: optional, audited reason for
 * security-sensitive admin actions (reset-password, revoke-all). Additive —
 * older callers that POST with no body still validate (reason undefined).
 */
export const reasonBody = z.object({
  reason: z.string().min(3).max(500).optional(),
});
export type ReasonBody = z.infer<typeof reasonBody>;

export const userIdParam   = z.object({ id: z.string().uuid() });
export const tenantIdQuery = z.object({
  tenantId: z.string().uuid(),
  limit:    z.coerce.number().int().min(1).max(200).default(50),
  offset:   z.coerce.number().int().min(0).default(0),
});

/** GAP-ADMIN-USERS-03: server-side directory search (name / email / employee code substring, status, paging). */
export const userSearchQuery = z.object({
  tenantId: z.string().uuid(),
  q:        z.string().trim().max(100).optional(),
  status:   z.enum(USER_STATUSES).optional(),
  limit:    z.coerce.number().int().min(1).max(200).default(25),
  offset:   z.coerce.number().int().min(0).default(0),
});
