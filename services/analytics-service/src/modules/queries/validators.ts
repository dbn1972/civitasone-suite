import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";
import { querySpecSchema } from "../registry/spec.js";

export const idParam = z.object({ id: z.string().uuid() });

export const runQueryBody = z
  .object({
    queryName: z.string().min(1).max(200),
    dashboardId: z.string().uuid().optional(),
    /** Structured spec — the ONLY way to express a query. No raw SQL field exists. */
    spec: querySpecSchema,
  })
  .strict();
export type RunQueryBody = z.infer<typeof runQueryBody>;

export const scheduleQueryBody = z
  .object({
    name: z.string().min(1).max(200),
    spec: querySpecSchema,
    cadence: z.enum(["hourly", "daily", "weekly", "monthly"]).default("daily"),
    enabled: z.boolean().default(true),
  })
  .strict();
export type ScheduleQueryBody = z.infer<typeof scheduleQueryBody>;

export const createExportBody = z
  .object({
    queryRunId: z.string().uuid(),
    format: z.enum(["csv", "xlsx", "json"]).default("csv"),
  })
  .strict();
export type CreateExportBody = z.infer<typeof createExportBody>;

// ── response schemas ──────────────────────────────────────────────────────
export const queryRunViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  dashboardId: z.string().uuid().nullable(),
  queryName: z.string(),
  status: z.string(),
  kind: z.string(),
  spec: z.record(z.unknown()),
  result: z.record(z.unknown()).nullable(),
  resultRows: z.number().int(),
  error: z.string().nullable(),
  version: z.number().int(),
});
export const queryRunsListSchema = paginatedSchema(queryRunViewSchema);

export const scheduledViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  spec: z.record(z.unknown()),
  cadence: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
});
export const scheduledListSchema = paginatedSchema(scheduledViewSchema);

export const exportViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  queryRunId: z.string().uuid().nullable(),
  format: z.string(),
  status: z.string(),
  rowCount: z.number().int().nullable(),
  downloadUrl: z.string().nullable(),
  version: z.number().int(),
});
export const exportsListSchema = paginatedSchema(exportViewSchema);

export const catalogSchema = z.object({
  metrics: z.array(z.object({ key: z.string(), label: z.string(), agg: z.string() })),
  dimensions: z.array(z.object({ key: z.string(), label: z.string() })),
  filters: z.array(z.object({ key: z.string(), label: z.string(), type: z.string() })),
  operators: z.array(z.string()),
});
