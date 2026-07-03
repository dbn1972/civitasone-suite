import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const templateTypeEnum = z.enum(["email", "letter", "certificate"]);

export const createTemplateBody = z.object({
  type: templateTypeEnum,
  name: z.string().min(1).max(256),
  htmlBody: z.string().min(1).max(100_000),
  variables: z.record(z.string(), z.string()).optional(),
});
export type CreateTemplateBody = z.infer<typeof createTemplateBody>;

export const updateTemplateBody = z.object({
  name: z.string().min(1).max(256).optional(),
  htmlBody: z.string().min(1).max(100_000).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});
export type UpdateTemplateBody = z.infer<typeof updateTemplateBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const templateViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: templateTypeEnum,
  name: z.string(),
  htmlBody: z.string(),
  variables: z.record(z.string(), z.string()).nullable(),
  version: z.number().int(),
});

export const templatesListSchema = paginatedSchema(templateViewSchema);
