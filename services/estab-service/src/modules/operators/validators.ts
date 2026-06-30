import { z } from "zod";

export const DESK_ROLES = [
  "dealing_hand", "section_officer", "under_secretary",
  "deputy_secretary", "director", "hod",
] as const;
export type DeskRole = (typeof DESK_ROLES)[number];

export const enrolOperatorBody = z.object({
  employeeId:  z.string().uuid(),
  division:    z.string().min(1).max(120),
  section:     z.string().min(1).max(120).optional(),
  deskRole:    z.enum(DESK_ROLES).default("dealing_hand"),
  canInitiate: z.boolean().default(true),
  clearanceLevel: z.number().int().min(1).max(4).default(1),
});
export type EnrolOperatorBody = z.infer<typeof enrolOperatorBody>;

export const updateOperatorBody = z.object({
  division:    z.string().min(1).max(120).optional(),
  section:     z.string().min(1).max(120).nullable().optional(),
  deskRole:    z.enum(DESK_ROLES).optional(),
  canInitiate: z.boolean().optional(),
  clearanceLevel: z.number().int().min(1).max(4).optional(),
  active:      z.boolean().optional(),
});
export type UpdateOperatorBody = z.infer<typeof updateOperatorBody>;

export const listOperatorsQuery = z.object({
  division: z.string().min(1).optional(),
  deskRole: z.enum(DESK_ROLES).optional(),
  activeOnly: z.coerce.boolean().default(true),
  limit:    z.coerce.number().int().min(1).max(500).default(200),
});

export const eligibilityQuery = z.object({
  employeeId: z.string().uuid(),
  division:   z.string().min(1).optional(),
  initiate:   z.coerce.boolean().default(false),
});
