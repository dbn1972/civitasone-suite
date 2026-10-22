import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

const entityType = z.enum(["leads", "contacts", "deals"]);
const fieldType = z.enum(["text", "number", "date", "boolean", "select", "multi_select"]);

/**
 * GAP-CRM-CUSTOM-FIELDS-01: `validationSchema` is stored as free-form JSON (no
 * migration), but the keys the admin screen writes are typed here. Without this a
 * malformed `sensitive` ("yes", 1) or `visibleToRoles` (a string, a number) would be
 * stored verbatim and a later reader enforcing masking / export exclusion would
 * silently treat the field as unprotected. Unknown keys pass through untouched.
 *
 * `visibleToRoles` only means anything on a sensitive field: stored without
 * `sensitive: true` it would read as a restriction while the value stays visible to
 * everyone, so that combination is refused rather than stored.
 */
export const CUSTOM_FIELD_ROLE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
export const VISIBLE_TO_ROLES_REQUIRES_SENSITIVE = "VISIBLE_TO_ROLES_REQUIRES_SENSITIVE";

export const customFieldValidationSchema = z
  .object({
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    sensitive: z.boolean().optional(),
    visibleToRoles: z.array(z.string().regex(CUSTOM_FIELD_ROLE_PATTERN)).max(20).optional(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.visibleToRoles !== undefined && v.sensitive !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: VISIBLE_TO_ROLES_REQUIRES_SENSITIVE,
        path: ["visibleToRoles"],
      });
    }
  })
  .nullable()
  .optional();

export const createCustomFieldBody = z.object({
  entityType,
  fieldName: z.string().min(1).max(64),
  fieldType,
  validationSchema: customFieldValidationSchema,
  ordinal: z.number().int().min(0).default(0),
});
export type CreateCustomFieldBody = z.infer<typeof createCustomFieldBody>;

export const updateCustomFieldBody = z.object({
  fieldName: z.string().min(1).max(64).optional(),
  fieldType: fieldType.optional(),
  validationSchema: customFieldValidationSchema,
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
