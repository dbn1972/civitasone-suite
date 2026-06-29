export const COMMANDS = {
  createStage: "install.stage.create",
  wizardCreate: "install.wizard.create",
  stepStart: "install.step.start",
  stepComplete: "install.step.complete",
  stepSkip: "install.step.skip",
  siloProvisionUpdate: "install.silo_provision.update",
} as const;

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
