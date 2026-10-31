import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

// subdivision and tehsil are revenue-hierarchy levels (hierarchy UNIT_TYPES lists both; the pilot
// organogram seed writes them). Mirrors jurisdictions_level_check (migrations/0028).
export const JURISDICTION_LEVELS = ["state", "district", "subdivision", "tehsil", "block", "gp", "ward", "zone"] as const;

export const assignJurisdictionBody = z.object({
  officeId: z.string().uuid("Select a valid office"),
  unitId: z.string().uuid("Select a valid administrative unit"),
  level: z.enum(JURISDICTION_LEVELS, { message: "Choose a valid jurisdiction level" }),
  isPrimary: z.boolean().default(false),
});
export type AssignJurisdictionBody = z.infer<typeof assignJurisdictionBody>;

export const revokeJurisdictionBody = z.object({
  id: z.string().uuid("Select a valid jurisdiction"),
});
export type RevokeJurisdictionBody = z.infer<typeof revokeJurisdictionBody>;

export const jurisdictionQueryParams = z.object({
  officeId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
});
export type JurisdictionQueryParams = z.infer<typeof jurisdictionQueryParams>;

export const idParam = z.object({ id: z.string().uuid() });

export const jurisdictionViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  officeId: z.string().uuid(),
  unitId: z.string().uuid(),
  level: z.enum(JURISDICTION_LEVELS),
  isPrimary: z.boolean(),
  version: z.number().int(),
});

export const jurisdictionsListSchema = paginatedSchema(jurisdictionViewSchema);
