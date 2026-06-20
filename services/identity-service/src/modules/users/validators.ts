import { z } from "zod";

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
  status: z.enum(["active", "suspended", "locked", "deactivated"]),
  reason: z.string().min(3).max(500).optional(),
});
export type StatusBody = z.infer<typeof statusBody>;

export const userIdParam   = z.object({ id: z.string().uuid() });
export const tenantIdQuery = z.object({
  tenantId: z.string().uuid(),
  limit:    z.coerce.number().int().min(1).max(200).default(50),
  offset:   z.coerce.number().int().min(0).default(0),
});
