import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

// Canonical district-governance level taxonomy (mirrors hierarchy.unit_types in
// migration 0012). Adding a novel state-specific level = INSERT into
// hierarchy.unit_types (+ optionally extend this list); the DB FK is the
// integrity backstop.
export const UNIT_TYPES = [
  "nation", "state", "division", "range", "district", "police_district",
  "zone", "subdivision", "police_subdivision", "ulb", "circle", "tehsil",
  "block", "police_station", "ward", "gp", "beat", "village",
] as const;

export const createUnitBody = z.object({
  code: z.string().min(1, "Code is required").max(32, "Code must be 32 characters or fewer"),
  name: z.string().min(1, "Name is required").max(200, "Name must be 200 characters or fewer"),
  type: z.enum(UNIT_TYPES, { message: "Choose a valid unit type" }),
  parentId: z.string().uuid("Select a valid parent unit").optional(),
  population: z.number().int().nonnegative("Population must be non-negative").optional(),
  areaKm2: z.number().int().nonnegative("Area must be non-negative").optional(),
  pinCodes: z.array(z.string().regex(/^\d{6}$/, "PIN code must be 6 digits")).optional(),
  lgdCode: z
    .string()
    .min(1, "LGD code cannot be empty")
    .max(32, "LGD code must be 32 characters or fewer")
    .regex(/^\d+$/, "LGD code must contain digits only")
    .optional(),
});
export type CreateUnitBody = z.infer<typeof createUnitBody>;

export const updateUnitBody = z.object({
  name: z.string().min(1).max(200).optional(),
  population: z.number().int().nonnegative().optional(),
  areaKm2: z.number().int().nonnegative().optional(),
  pinCodes: z.array(z.string().regex(/^\d{6}$/)).optional(),
  lgdCode: z.string().min(1).max(32).regex(/^\d+$/).optional(),
  parentId: z.string().uuid().nullable().optional(),
});
export type UpdateUnitBody = z.infer<typeof updateUnitBody>;

export const bulkSyncBody = z.object({
  units: z.array(createUnitBody).min(1, "At least one unit required").max(5000, "Maximum 5000 units per batch"),
});
export type BulkSyncBody = z.infer<typeof bulkSyncBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const unitViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  type: z.enum(UNIT_TYPES),
  parentId: z.string().uuid().nullable(),
  population: z.number().int().nullable(),
  areaKm2: z.number().int().nullable(),
  pinCodes: z.array(z.string()).nullable(),
  lgdCode: z.string().nullable(),
  version: z.number().int(),
});

export type UnitTreeNode = z.infer<typeof unitViewSchema> & {
  children: UnitTreeNode[];
};

export const unitTreeNodeSchema: z.ZodType<UnitTreeNode> = unitViewSchema.extend({
  children: z.lazy(() => z.array(unitTreeNodeSchema)),
});

export const hierarchyTreeSchema = z.object({
  data: z.array(unitTreeNodeSchema),
});

export const unitsListSchema = paginatedSchema(unitViewSchema);
