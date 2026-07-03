import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const registerHookBody = z.object({
  pluginId: z.string().uuid(),
  eventType: z.string().min(1).max(128),
  handlerPath: z.string().min(1).max(512),
});
export type RegisterHookBody = z.infer<typeof registerHookBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const hookViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  pluginId: z.string().uuid(),
  eventType: z.string(),
  handlerPath: z.string(),
  active: z.boolean(),
  version: z.number().int(),
});

export const hooksListSchema = paginatedSchema(hookViewSchema);
