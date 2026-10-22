import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const pluginStateEnum = z.enum(["uploaded", "installed", "enabled", "active", "disabled", "uninstalled"]);

export const installPluginBody = z.object({
  manifestJson: z.record(z.string(), z.unknown()),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type InstallPluginBody = z.infer<typeof installPluginBody>;

export const configurePluginBody = z.object({
  config: z.record(z.string(), z.unknown()),
});
export type ConfigurePluginBody = z.infer<typeof configurePluginBody>;

/** Disabling a plugin removes the feature for every tenant user, so the audited reason is mandatory. */
export const disablePluginBody = z.object({
  reason: z.string().trim().min(3, "state the reason for disabling (min 3 characters)").max(500),
});
export type DisablePluginBody = z.infer<typeof disablePluginBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const pluginViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  manifestJson: z.record(z.string(), z.unknown()),
  state: pluginStateEnum,
  installedAt: z.string().nullable(),
  enabledAt: z.string().nullable(),
  disabledAt: z.string().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  version: z.number().int(),
});

export const pluginsListSchema = paginatedSchema(pluginViewSchema);
