import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

const entityType = z.enum(["leads", "contacts", "deals"]);
const fieldType = z.enum(["text", "number", "date", "boolean", "select", "multi_select"]);

export const createCustomFieldBody = z.object({
  entityType,
  fieldName: z.string().min(1).max(64),
  fieldType,
  validationSchema: z.unknown().optional(),
  ordinal: z.number().int().min(0).default(0),
});
export type CreateCustomFieldBody = z.infer<typeof createCustomFieldBody>;

export const updateCustomFieldBody = z.object({
  fieldName: z.string().min(1).max(64).optional(),
  fieldType: fieldType.optional(),
  validationSchema: z.unknown().optional(),
  ordinal: z.number().int().min(0).optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
export type UpdateCustomFieldBody = z.infer<typeof updateCustomFieldBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const customFieldViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityType,
  fieldName: z.string(),
  fieldType,
  validationSchema: z.unknown().nullable(),
  ordinal: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const customFieldsListSchema = paginatedSchema(customFieldViewSchema);

export const entityTypeParam = z.object({ entityType });
