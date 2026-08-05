/** zod validators — applied at the route boundary for template operations. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const templateFilterSchema = z.object({
  field: z.string().min(1).max(128),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "between", "like"]),
  value: z.unknown(),
});

export const templateGroupSchema = z.object({
  field: z.string().min(1).max(128),
  label: z.string().max(128).optional(),
});

export const templateAggregationSchema = z.object({
  field: z.string().min(1).max(128),
  function: z.enum(["count", "sum", "avg", "min", "max"]),
  alias: z.string().max(128).optional(),
});

export const templateParameterSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(["string", "number", "date", "enum"]),
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string().max(256)).max(100).optional(),
});

export const createTemplateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  dataSourceId: z.string().min(1).max(128),
  filters: z.array(templateFilterSchema).max(20).default([]),
  groups: z.array(templateGroupSchema).max(4).default([]),
  aggregations: z.array(templateAggregationSchema).default([]),
  parameters: z.array(templateParameterSchema).max(20).default([]),
  outputFormat: z.enum(["pdf", "xlsx", "csv"]).default("pdf"),
  watermark: z.string().max(200).optional(),
  piiColumns: z.array(z.string().min(1).max(128)).max(50).optional(),
});
export type CreateTemplateBody = z.infer<typeof createTemplateBody>;

export const updateTemplateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  dataSourceId: z.string().min(1).max(128).optional(),
  filters: z.array(templateFilterSchema).max(20).optional(),
  groups: z.array(templateGroupSchema).max(4).optional(),
  aggregations: z.array(templateAggregationSchema).optional(),
  parameters: z.array(templateParameterSchema).max(20).optional(),
  outputFormat: z.enum(["pdf", "xlsx", "csv"]).optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  watermark: z.string().max(200).nullable().optional(),
  piiColumns: z.array(z.string().min(1).max(128)).max(50).nullable().optional(),
  version: z.number().int().min(1),
});
export type UpdateTemplateBody = z.infer<typeof updateTemplateBody>;

export const executeTemplateBody = z.object({
  parameters: z.record(z.string(), z.unknown()).default({}),
  outputFormat: z.enum(["pdf", "xlsx", "csv"]).optional(),
});
export type ExecuteTemplateBody = z.infer<typeof executeTemplateBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const templateViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  dataSourceId: z.string(),
  filters: z.array(templateFilterSchema),
  groups: z.array(templateGroupSchema),
  aggregations: z.array(templateAggregationSchema),
  parameters: z.array(templateParameterSchema),
  outputFormat: z.string(),
  status: z.string(),
  version: z.number().int(),
});

export const templatesListSchema = paginatedSchema(templateViewSchema);
