/** Topic + event names owned by admin-service. */
export const COMMANDS = {
  tenantCreate:       "admin.tenant.create",
  tenantEditionChange:"admin.tenant.edition_change",
  tenantSuspend:      "admin.tenant.suspend",
  tenantReactivate:   "admin.tenant.reactivate",
  tenantSync:         "admin.tenant.sync",
  moduleToggle:       "admin.module.toggle",
  featureFlagCreate:  "admin.feature_flag.create",
  featureFlagOverride:"admin.feature_flag.override",
  backupSchedule:     "admin.backup.schedule",
  backupTrigger:      "admin.backup.trigger",
  breakGlassOpen:     "admin.breakglass.open",
  breakGlassClose:    "admin.breakglass.close",
} as const;

export const EVENTS = {
  tenantCreated:   "admin.tenant.created",
  tenantSuspended: "admin.tenant.suspended",
  breakGlassOpened:"admin.breakglass.opened",
  breakGlassClosed:"admin.breakglass.closed",
} as const;

export const SERVICE = "admin";
export const RESOURCE_TENANT = "tenant";
