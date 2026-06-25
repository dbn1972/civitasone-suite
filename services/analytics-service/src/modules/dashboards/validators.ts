import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";
import { querySpecSchema } from "../registry/spec.js";

export const idParam = z.object({ id: z.string().uuid() });

export const layoutSchema = z
  .object({
    columns: z.number().int().min(1).max(12).optional(),
    order: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict();

export const createDashboardBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    visibility: z.enum(["private", "shared"]).default("private"),
    layout: layoutSchema.default({}),
  })
  .strict();
export type CreateDashboardBody = z.infer<typeof createDashboardBody>;

export const updateDashboardBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
    visibility: z.enum(["private", "shared"]).optional(),
    layout: layoutSchema.optional(),
    /** optimistic lock — client echoes the version it last read */
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export type UpdateDashboardBody = z.infer<typeof updateDashboardBody>;

export const addWidgetBody = z
  .object({
    title: z.string().min(1).max(200),
    vizType: z.enum(["table", "bar", "line", "stat"]).default("table"),
    spec: querySpecSchema,
    position: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export type AddWidgetBody = z.infer<typeof addWidgetBody>;

export const shareDashboardBody = z
  .object({
    principalId: z.string().uuid(),
    access: z.enum(["view", "edit"]).default("view"),
  })
  .strict();
export type ShareDashboardBody = z.infer<typeof shareDashboardBody>;

// ── response schemas ──────────────────────────────────────────────────────
export const dashboardViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  ownerId: z.string().uuid().nullable(),
  visibility: z.string(),
  layout: z.record(z.unknown()),
  version: z.number().int(),
});
export const dashboardsListSchema = paginatedSchema(dashboardViewSchema);

export const widgetViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  dashboardId: z.string().uuid(),
  title: z.string(),
  vizType: z.string(),
  spec: z.record(z.unknown()),
  position: z.number().int(),
  version: z.number().int(),
});

export const dashboardDetailSchema = dashboardViewSchema.extend({
  widgets: z.array(widgetViewSchema),
  shares: z.array(
    z.object({
      id: z.string().uuid(),
      dashboardId: z.string().uuid(),
      principalId: z.string().uuid(),
      access: z.string(),
    }),
  ),
});
