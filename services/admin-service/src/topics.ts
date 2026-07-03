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
  // ── scheduled jobs ─────────────────────────────────────────────────────
  scheduledJobCreate: "admin.scheduled_job.create",
  scheduledJobUpdate: "admin.scheduled_job.update",
  scheduledJobDelete: "admin.scheduled_job.delete",
  scheduledJobRunNow: "admin.scheduled_job.run_now",
  scheduledJobPause:  "admin.scheduled_job.pause",
  scheduledJobResume: "admin.scheduled_job.resume",
  // ── custom domains ─────────────────────────────────────────────────────
  customDomainRegister: "admin.custom_domain.register",
  customDomainVerify:   "admin.custom_domain.verify",
  customDomainDelete:   "admin.custom_domain.delete",
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
  // ── scheduled jobs ─────────────────────────────────────────────────────
  scheduledJobCreated:  "admin.scheduled_job.created",
  scheduledJobUpdated:  "admin.scheduled_job.updated",
  scheduledJobDeleted:  "admin.scheduled_job.deleted",
  scheduledJobRunTriggered: "admin.scheduled_job.run_triggered",
  scheduledJobPaused:   "admin.scheduled_job.paused",
  scheduledJobResumed:  "admin.scheduled_job.resumed",
  // ── custom domains ─────────────────────────────────────────────────────
  customDomainRegistered: "admin.custom_domain.registered",
  customDomainVerified:   "admin.custom_domain.verified",
  customDomainDeleted:    "admin.custom_domain.deleted",
} as const;

export const SERVICE = "admin";
export const RESOURCE_TENANT = "tenant";
