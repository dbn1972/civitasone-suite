/** Topic names owned by the tenant-settings module (kept out of the shared topics.ts to avoid merge churn). */
export const SETTINGS_COMMANDS = {
  update: "admin.tenant_settings.update",
  emailTest: "admin.tenant_settings.email_test",
  logoSet: "admin.tenant_settings.logo_set",
  logoRemove: "admin.tenant_settings.logo_remove",
} as const;

export const SETTINGS_EVENTS = {
  updated: "admin.tenant_settings.updated",
  logoChanged: "admin.tenant_settings.logo_changed",
} as const;
