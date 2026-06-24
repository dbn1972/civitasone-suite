import { z } from "zod";

export const createRoleBody = z.object({
  key:         z.string().min(1).max(64).regex(/^[a-z0-9_.:-]+$/, "lowercase key"),
  name:        z.string().min(1).max(200),
  description: z.string().max(500).optional(),
});
export type CreateRoleBody = z.infer<typeof createRoleBody>;

export const createPermissionBody = z.object({
  key:         z.string().min(1).max(128).regex(/^[a-z0-9_.:-]+$/, "lowercase key"),
  name:        z.string().min(1).max(200),
  description: z.string().max(500).optional(),
});
export type CreatePermissionBody = z.infer<typeof createPermissionBody>;

export const rolePermissionBody = z.object({
  permissionId: z.string().uuid(),
});
export type RolePermissionBody = z.infer<typeof rolePermissionBody>;

export const assignRoleBody = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(3).max(500).optional(),
});
export type AssignRoleBody = z.infer<typeof assignRoleBody>;

export const revokeRoleBody = z.object({
  reason: z.string().min(3).max(500).optional(),
});
export type RevokeRoleBody = z.infer<typeof revokeRoleBody>;

export const roleIdParam       = z.object({ id: z.string().uuid() });
export const roleUserParam     = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
export const rolePermParam     = z.object({ id: z.string().uuid(), permissionId: z.string().uuid() });
export const userIdParam       = z.object({ userId: z.string().uuid() });
export const listQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
