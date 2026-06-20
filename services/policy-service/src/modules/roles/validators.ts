import { z } from "zod";

export const createRoleBody = z.object({
  name:        z.string().min(1).max(128),
  description: z.string().max(500).optional(),
});
export type CreateRoleBody = z.infer<typeof createRoleBody>;

export const updateRoleBody = z.object({
  name:        z.string().min(1).max(128).optional(),
  description: z.string().max(500).optional(),
}).refine((b) => b.name !== undefined || b.description !== undefined, { message: "at least one field required" });
export type UpdateRoleBody = z.infer<typeof updateRoleBody>;

export const addPermissionBody = z.object({
  resource: z.string().min(1).max(128),
  action:   z.string().min(1).max(64),
  effect:   z.enum(["allow", "deny"]).default("allow"),
});
export type AddPermissionBody = z.infer<typeof addPermissionBody>;

export const roleIdParam = z.object({ id: z.string().uuid() });
