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
  // ── WC-009 sandbox masked refresh ──────────────────────────────────────
  /**
   * COMMAND: execute an APPROVED sandbox refresh.
   * Payload: `{ jobId: string; sandboxId: string; tenantId: string }`
   * Published by: `POST /v1/admin/sandbox-refreshes/:id/approve` (after the
   * second approver has signed off), in the same transaction as the job's
   * flip to `queued`.
   * Consumed by: `registerSandboxConsumers` (wired in src/worker.ts). The
   * consumer resolves the masking plan, records what was masked and closes the
   * job — the ACTUAL data copy is an explicit stub at that boundary.
   */
  sandboxRefreshExecute: "admin.sandbox_refresh.execute",
  securityIncidentCreate: "admin.security_incident.create",
  securityIncidentTransition: "admin.security_incident.transition",
  securityIncidentClose: "admin.security_incident.close",
  securityBreachNotificationCreate: "admin.security_breach_notification.create",
  securityBreachNotificationSubmit: "admin.security_breach_notification.submit",
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

  // ══ WC-010 — configuration as a versioned artefact ══════════════════════
  /**
   * A config set was snapshotted as a new immutable artefact version.
   * Payload: `{ artefactId: string; setKey: string; artefactVersion: number; checksum: string }`
   * Fires: on `POST /v1/admin/config-artefacts`, inside the same transaction
   * as the config_artefacts INSERT. No in-service consumer — published for
   * audit-service and any external release-tracking subscriber.
   */
  configArtefactSnapshotted: "admin.config_artefact.snapshotted",
  /**
   * A promotion of an artefact version into an environment was REQUESTED
   * (maker half of maker-checker); nothing is live yet.
   * Payload: `{ promotionId: string; setKey: string; artefactVersion: number; targetEnv: string }`
   * Fires: on `POST /v1/admin/config-artefacts/promotions`.
   */
  configPromotionRequested: "admin.config_promotion.requested",
  /**
   * A promotion was APPROVED by a second actor and the environment now runs
   * that artefact version.
   * Payload: `{ promotionId: string; setKey: string; artefactId: string;
   *            artefactVersion: number; environment: string;
   *            approvedBy: string; requestedBy: string }`
   * Fires: on `POST /v1/admin/config-artefacts/promotions/:id/approve`, in the
   * same transaction as the config_env_state write. `approvedBy` is guaranteed
   * different from `requestedBy` (separation of duties).
   */
  configArtefactPromoted: "admin.config_artefact.promoted",
  /**
   * A pending promotion was rejected; no environment changed.
   * Payload: `{ promotionId: string; setKey: string; targetEnv: string }`
   * Fires: on `POST /v1/admin/config-artefacts/promotions/:id/reject`.
   */
  configPromotionRejected: "admin.config_promotion.rejected",
  /**
   * An environment was rolled back to an earlier, previously-approved artefact.
   * Payload: `{ promotionId: string; setKey: string; environment: string;
   *            fromVersion: number; toVersion: number }`
   * Fires: on `POST /v1/admin/config-artefacts/environments/:env/rollback`.
   */
  configArtefactRolledBack: "admin.config_artefact.rolled_back",

  // ══ WC-009 — sandbox environments with masked refresh ═══════════════════
  /**
   * A sandbox environment was registered. No data has been copied into it.
   * Payload: `{ sandboxId: string; code: string; sourceEnvironment: string }`
   * Fires: on `POST /v1/admin/sandboxes`.
   */
  sandboxRegistered: "admin.sandbox.registered",
  /**
   * A masked refresh was REQUESTED (maker half); awaiting a second approver.
   * Payload: `{ jobId: string; sandboxId: string; sourceEnvironment: string }`
   * Fires: on `POST /v1/admin/sandboxes/:id/refreshes`.
   */
  sandboxRefreshRequested: "admin.sandbox_refresh.requested",
  /**
   * A refresh was approved by a DIFFERENT actor and queued for execution.
   * Payload: `{ jobId: string; sandboxId: string; requestedBy: string; approvedBy: string }`
   * Fires: on `POST /v1/admin/sandbox-refreshes/:id/approve`, in the same
   * transaction that flips the job to `queued` and publishes the
   * `sandboxRefreshExecute` COMMAND.
   */
  sandboxRefreshApproved: "admin.sandbox_refresh.approved",
  /** A refresh request was rejected. Payload: `{ jobId: string; sandboxId: string }` */
  sandboxRefreshRejected: "admin.sandbox_refresh.rejected",
  /**
   * The refresh orchestration finished. NOTE: `dataMovement` is always
   * `"stubbed"` in this build — admin-service records WHAT would be masked and
   * never copies production data (see modules/sandbox/consumer.ts).
   * Payload: `{ jobId: string; sandboxId: string; maskedFieldCount: number;
   *            preservedFieldCount: number; dataMovement: "stubbed" | "executed" }`
   * Fires: from the `admin.sandbox_refresh.execute` consumer.
   */
  sandboxRefreshCompleted: "admin.sandbox_refresh.completed",

  // ══ ORG-07 — department template clone ═════════════════════════════════
  /**
   * A department's configuration was cloned into a reusable template.
   * Payload: `{ templateId: string; code: string; droppedRefCount: number }`
   * Fires: on `POST /v1/admin/department-templates`.
   */
  departmentTemplateCreated: "admin.department_template.created",
  /**
   * A template was instantiated as a new department configuration. The owning
   * service (hrms/estab) creates the actual department from this event —
   * admin-service holds the template + instantiation record only.
   * Payload: `{ instantiationId: string; templateId: string; templateVersion: number;
   *            departmentCode: string; departmentName: string; config: object }`
   * Fires: on `POST /v1/admin/department-templates/:id/instantiate` (first call
   * for an idempotency key only — a repeat is a read, not a re-publish).
   */
  departmentInstantiated: "admin.department.instantiated",

  // ══ DM-002 — document types, mandatory documents, expiry ═══════════════
  /**
   * A document is inside its type's expiry warning window.
   * Payload: `{ documentId: string; documentTypeCode: string; contextType: string;
   *            contextKey: string; subjectId: string; expiresAt: string;
   *            daysRemaining: number }`
   * Fires: from `POST /v1/admin/documents/expiry-scan` for each document whose
   * status transitions to `expiring`. CONSUMED BY notification-service (it owns
   * the alert channel/template); admin-service only publishes.
   * PII: carries identifiers and dates only, never document contents.
   */
  documentExpiring: "admin.document.expiring",
  /**
   * A document's expiry date has passed.
   * Payload: `{ documentId: string; documentTypeCode: string; contextType: string;
   *            contextKey: string; subjectId: string; expiresAt: string }`
   * Fires: from `POST /v1/admin/documents/expiry-scan` for each document whose
   * status transitions to `expired`. CONSUMED BY notification-service.
   */
  documentExpired: "admin.document.expired",
} as const;

export const SERVICE = "admin";
export const RESOURCE_TENANT = "tenant";
