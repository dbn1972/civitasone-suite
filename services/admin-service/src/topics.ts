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
  featureFlagUpdate:  "admin.feature_flag.update",
  featureFlagKill:    "admin.feature_flag.kill",
  featureFlagDelete:  "admin.feature_flag.delete",
  dataExportRequest:  "admin.data_export.request",
  dataExportProcess:  "admin.data_export.process",
  webhookCreate:      "admin.webhook.create",
  webhookUpdate:      "admin.webhook.update",
  webhookDelete:      "admin.webhook.delete",
  webhookTest:        "admin.webhook.test",
  backupSchedule:     "admin.backup.schedule",
  backupTrigger:      "admin.backup.trigger",
  breakGlassOpen:     "admin.breakglass.open",
  breakGlassClose:    "admin.breakglass.close",
} as const;

export const EVENTS = {
  tenantCreated:      "admin.tenant.created",
  tenantSuspended:    "admin.tenant.suspended",
  breakGlassOpened:   "admin.breakglass.opened",
  breakGlassClosed:   "admin.breakglass.closed",
  featureFlagCreated: "admin.feature_flag.created",
  featureFlagUpdated: "admin.feature_flag.updated",
  featureFlagKilled:  "admin.feature_flag.killed",
  dataExportReady:    "admin.data_export.ready",
  webhookCreated:     "admin.webhook.created",
} as const;

export const SERVICE = "admin";
export const RESOURCE_TENANT = "tenant";
