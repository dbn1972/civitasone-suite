import { z } from "zod";
import { ORG_UNIT_TYPES } from "./domain.js";

export const createOrgUnitBody = z.object({
  code:           z.string().min(1).max(64),
  name:           z.string().min(1).max(200),
  type:           z.enum(ORG_UNIT_TYPES),
  parentId:       z.string().uuid().nullable().default(null),
  headOperatorId: z.string().uuid().nullable().default(null),
});
export type CreateOrgUnitBody = z.infer<typeof createOrgUnitBody>;

export const updateOrgUnitBody = z.object({
  name:           z.string().min(1).max(200).optional(),
  parentId:       z.string().uuid().nullable().optional(),
  headOperatorId: z.string().uuid().nullable().optional(),
  active:         z.boolean().optional(),
});
export type UpdateOrgUnitBody = z.infer<typeof updateOrgUnitBody>;

export const listOrgUnitsQuery = z.object({
  type:     z.enum(ORG_UNIT_TYPES).optional(),
  parentId: z.string().uuid().optional(),
  activeOnly: z.coerce.boolean().default(true),
  limit:    z.coerce.number().int().min(1).max(1000).default(500),
});
