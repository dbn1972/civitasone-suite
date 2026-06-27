import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

/** Allowed branch-office / jurisdiction types, top of the tree to the leaf. */
export const LOCATION_TYPES = [
  "state",
  "district",
  "block",
  "ward",
  "office",
  "facility",
  "branch",
] as const;

export const createLocationBody = z.object({
  name: z.string({ message: "Branch office name is required" }).min(1, "Branch office name is required").max(200, "Branch office name must be 200 characters or fewer"),
  addressLine: z.string().min(1, "Address line cannot be empty").max(500, "Address line must be 500 characters or fewer").optional(),
  city: z.string().min(1, "City cannot be empty").max(120, "City must be 120 characters or fewer").optional(),
  postalCode: z.string().min(1, "Postal code cannot be empty").max(16, "Postal code must be 16 characters or fewer").optional(),
  type: z.enum(LOCATION_TYPES, { message: "Choose a valid location type" }).default("office"),
  lgdCode: z
    .string()
    .min(1, "LGD code cannot be empty")
    .max(32, "LGD code must be 32 characters or fewer")
    .regex(/^\d+$/, "LGD code must contain digits only")
    .optional(),
  parentId: z.string().uuid("Select a valid parent office").optional(),
});
export type CreateLocationBody = z.infer<typeof createLocationBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const locationViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  type: z.string(),
  lgdCode: z.string().nullable(),
  status: z.string(),
  isSample: z.boolean(),
  version: z.number().int(),
});

export const locationsListSchema = paginatedSchema(locationViewSchema);

/** A node in the branch-office tree: a location view plus its nested children. */
export type LocationTreeNode = z.infer<typeof locationViewSchema> & {
  children: LocationTreeNode[];
};

export const locationTreeNodeSchema: z.ZodType<LocationTreeNode> = locationViewSchema.extend({
  children: z.lazy(() => z.array(locationTreeNodeSchema)),
});

export const locationTreeSchema = z.object({
  data: z.array(locationTreeNodeSchema),
});
