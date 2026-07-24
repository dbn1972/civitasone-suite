/** Topic + event names owned by admin-service. */
export const COMMANDS = {
  tenantCreate:       "admin.tenant.create",
  tenantEditionChange:"admin.tenant.edition_change",
  tenantSuspend:      "admin.tenant.suspend",
  tenantReactivate:   "admin.tenant.reactivate",
  tenantSync:         "admin.tenant.sync",
  moduleToggle:       "admin.module.toggle",
  // Platform-wide flag registry (config module — config.admin_feature_flags,
  // global + per-tenant `overrides` jsonb).
  featureFlagCreate:  "admin.feature_flag.create",
  featureFlagOverride:"admin.feature_flag.override",
  // Tenant-scoped flag "manage" screen (feature-flags module —
  // feature_flags.feature_flags, one row per tenant per key). Deliberately a
  // DISTINCT topic from featureFlagCreate above: both worker.ts consumers
  // (registerConfigConsumers + registerFeatureFlagConsumers) are subscribed
  // on the same queue, and MemoryQueue.subscribe fans out to every handler
  // registered for a topic — reusing featureFlagCreate here previously made
  // every /v1/admin/feature-flags/manage POST also fire the config
  // consumer's handler with a payload shape it doesn't understand (`key` vs
  // `flagKey`), throwing a NOT NULL violation on `flag_key` inside that
  // consumer's own try/catch (silently logged, no bad row written, but pure
  // noise on every real feature-flag creation).
  featureFlagManageCreate: "admin.feature_flag_manage.create",
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
  // ── change / release management (SVC-130) ──────────────────────────────
  changeApproved:    "admin.change.approved",
  changeScheduled:   "admin.change.scheduled",
  changeCompleted:   "admin.change.completed",
  changeRolledBack:  "admin.change.rolled_back",
} as const;

export const SERVICE = "admin";
export const RESOURCE_TENANT = "tenant";
