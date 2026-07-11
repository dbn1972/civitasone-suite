/**
 * visitor-service: badge-print zod validators (routes.ts boundary).
 *
 * Validates HTTP request bodies, path params, and query strings for the
 * badge printing module endpoints. Enforces shape/type at the HTTP
 * boundary so malformed requests are rejected before reaching the queue.
 *
 * Requirements validated: 4.1, 4.2, 5.1, 5.7
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums (aligned with domain.ts and schema.ts values)
// ---------------------------------------------------------------------------

const printerLanguageEnum = z.enum(["zpl", "escpos"], {
  errorMap: () => ({ message: "printerLanguage must be one of: zpl, escpos" }),
});

const visitorCategoryEnum = z.enum(
  ["default", "walk_in", "pre_registered", "vip", "contractor", "group"],
  { errorMap: () => ({ message: "visitorCategory must be one of: default, walk_in, pre_registered, vip, contractor, group" }) },
);

const templateStatusEnum = z.enum(["active", "archived"], {
  errorMap: () => ({ message: "status must be one of: active, archived" }),
});

const printPriorityEnum = z.enum(["standard", "high"], {
  errorMap: () => ({ message: "priority must be one of: standard, high" }),
});

// ---------------------------------------------------------------------------
// 1. createTemplateBody — create a new badge template
// ---------------------------------------------------------------------------

export const createTemplateBody = z.object({
  name: z.string().min(1, "name is required").max(128, "name must be 128 characters or fewer"),
  printerLanguage: printerLanguageEnum,
  templateBody: z.string().min(1, "templateBody is required"),
  badgeWidthMm: z.number().int("badgeWidthMm must be an integer").positive("badgeWidthMm must be positive").optional().default(54),
  badgeHeightMm: z.number().int("badgeHeightMm must be an integer").positive("badgeHeightMm must be positive").optional().default(86),
  visitorCategory: visitorCategoryEnum.optional().default("default"),
});
export type CreateTemplateBody = z.infer<typeof createTemplateBody>;

// ---------------------------------------------------------------------------
// 2. updateTemplateBody — update an existing template (creates new version)
// ---------------------------------------------------------------------------

export const updateTemplateBody = z.object({
  name: z.string().min(1, "name is required").max(128, "name must be 128 characters or fewer").optional(),
  templateBody: z.string().min(1, "templateBody must not be empty").optional(),
  badgeWidthMm: z.number().int("badgeWidthMm must be an integer").positive("badgeWidthMm must be positive").optional(),
  badgeHeightMm: z.number().int("badgeHeightMm must be an integer").positive("badgeHeightMm must be positive").optional(),
  visitorCategory: visitorCategoryEnum.optional(),
});
export type UpdateTemplateBody = z.infer<typeof updateTemplateBody>;

// ---------------------------------------------------------------------------
// 3. createPriorityJobBody — create a priority print job manually
// ---------------------------------------------------------------------------

export const createPriorityJobBody = z.object({
  passId: z.string().uuid("invalid passId"),
  deviceId: z.string().uuid("invalid deviceId").optional(),
  priority: printPriorityEnum.optional().default("high"),
});
export type CreatePriorityJobBody = z.infer<typeof createPriorityJobBody>;

// ---------------------------------------------------------------------------
// 4. acknowledgeJobBody — printer acknowledges completion (empty body)
// ---------------------------------------------------------------------------

export const acknowledgeJobBody = z.object({});
export type AcknowledgeJobBody = z.infer<typeof acknowledgeJobBody>;

// ---------------------------------------------------------------------------
// 5. failJobBody — printer reports print failure
// ---------------------------------------------------------------------------

export const failJobBody = z.object({
  reason: z.string().optional(),
});
export type FailJobBody = z.infer<typeof failJobBody>;

// ---------------------------------------------------------------------------
// 6. listTemplatesQuery — query params for listing templates
// ---------------------------------------------------------------------------

export const listTemplatesQuery = z.object({
  printerLanguage: printerLanguageEnum.optional(),
  visitorCategory: visitorCategoryEnum.optional(),
  status: templateStatusEnum.optional().default("active"),
  page: z.coerce.number().int().min(1, "page must be >= 1").default(1),
  pageSize: z.coerce.number().int().min(1, "pageSize must be >= 1").max(200, "pageSize must be <= 200").default(20),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuery>;

// ---------------------------------------------------------------------------
// 7. templateIdParams — path params
// ---------------------------------------------------------------------------

export const templateIdParams = z.object({
  templateId: z.string().uuid("invalid templateId"),
});
export type TemplateIdParams = z.infer<typeof templateIdParams>;
