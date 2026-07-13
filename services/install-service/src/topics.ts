export const COMMANDS = {
  createStage: "install.stage.create",
  wizardCreate: "install.wizard.create",
  stepStart: "install.step.start",
  stepComplete: "install.step.complete",
  stepSkip: "install.step.skip",
  siloProvisionUpdate: "install.silo_provision.update",
} as const;

/**
 * Cross-service command topic consumed by tenant-service's `setIsolation`-shaped
 * registry-patch consumer (task 7.7, Req 3.4, design §(c) step 2). Hard-coded as
 * the published contract rather than imported so install-service keeps no build
 * dependency on tenant-service's source (same convention as
 * `services/meeting-service/src/modules/decision/consumer.ts`'s
 * `WORKFLOW_CREATE_INSTANCE`). Published ONLY on a confirmed transition into
 * `ready` (Req 4.2, 4.5) — never on `failed` or an intermediate status — so the
 * Tenant_Registry's `dbDsnRef` is patched exactly when the tenant's dedicated
 * database is actually usable.
 */
export const TENANT_SET_ISOLATION = "tenant.tenant.set_isolation";

export const EVENTS = {
  stageCreated: "install.stage.created",
  wizardCreated: "install.wizard.created",
  wizardCompleted: "install.wizard.completed",
  stepCompleted: "install.step.completed",
  stepSkipped: "install.step.skipped",
} as const;

export const SERVICE = "install";
export const RESOURCE = "stage";

/** Events consumed from other services. */
export const CONSUMED_EVENTS = {
  tenantIsolationChanged: "tenant.tenant.isolation_changed",
} as const;
