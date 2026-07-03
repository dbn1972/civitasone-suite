import { z } from "zod";

/**
 * All valid permission strings a plugin may request.
 */
export const VALID_PERMISSIONS = [
  // Finance
  "finance:invoice:read",
  "finance:invoice:write",
  "finance:invoice:delete",
  "finance:budget:read",
  "finance:budget:write",
  "finance:journal:read",
  "finance:journal:write",
  "finance:report:read",
  // HRMS
  "hrms:employee:read",
  "hrms:employee:write",
  "hrms:employee:delete",
  "hrms:leave:read",
  "hrms:leave:write",
  "hrms:attendance:read",
  "hrms:attendance:write",
  "hrms:payslip:read",
  // Procurement
  "procurement:requisition:read",
  "procurement:requisition:write",
  "procurement:order:read",
  "procurement:order:write",
  "procurement:order:approve",
  "procurement:vendor:read",
  "procurement:vendor:write",
  // Asset
  "asset:item:read",
  "asset:item:write",
  "asset:item:delete",
  "asset:transfer:read",
  "asset:transfer:write",
  // Project
  "project:project:read",
  "project:project:write",
  "project:project:delete",
  "project:task:read",
  "project:task:write",
  "project:milestone:read",
  "project:milestone:write",
  // Notification
  "notification:message:read",
  "notification:message:write",
  "notification:template:read",
  "notification:template:write",
  // Workflow
  "workflow:definition:read",
  "workflow:definition:write",
  "workflow:instance:read",
  "workflow:instance:write",
  // Citizen
  "citizen:request:read",
  "citizen:request:write",
  "citizen:feedback:read",
  "citizen:feedback:write",
  // Plugin store
  "store:data:read",
  "store:data:write",
  "store:data:delete",
] as const;

export type ValidPermission = (typeof VALID_PERMISSIONS)[number];

const hookSchema = z.object({
  onEvent: z
    .array(
      z.object({
        event: z.string().min(1),
        handler: z.string().min(1),
      }),
    )
    .optional(),
  onSchedule: z
    .array(
      z.object({
        cron: z.string().min(1),
        handler: z.string().min(1),
      }),
    )
    .optional(),
});

const uiSchema = z.object({
  pages: z
    .array(
      z.object({
        path: z.string().min(1),
        component: z.string().min(1),
      }),
    )
    .optional(),
  widgets: z
    .array(
      z.object({
        slot: z.string().min(1),
        component: z.string().min(1),
      }),
    )
    .optional(),
});

const apiSchema = z.object({
  routes: z
    .array(
      z.object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().min(1),
        handler: z.string().min(1),
      }),
    )
    .optional(),
});

const configSchema = z.object({
  schema: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Zod schema for validating plugin manifest files.
 */
export const pluginManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "Plugin id must be lowercase alphanumeric with hyphens",
    ),
  name: z.string().min(1).max(128),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Version must follow semver (e.g. 1.0.0)"),
  author: z.string().min(1),
  description: z.string().max(1024).optional(),
  license: z.string().min(1).optional(),
  minPlatformVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "minPlatformVersion must follow semver")
    .optional(),
  permissions: z.array(z.enum(VALID_PERMISSIONS)).default([]),
  hooks: hookSchema.optional(),
  ui: uiSchema.optional(),
  api: apiSchema.optional(),
  config: configSchema.optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/**
 * Validate a raw manifest object. Returns the parsed manifest or throws a ZodError.
 */
export function validateManifest(input: unknown): PluginManifest {
  return pluginManifestSchema.parse(input);
}
