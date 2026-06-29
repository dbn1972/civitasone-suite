/** Topic + event names owned by tenant-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createTenant: "tenant.tenant.create",
  updateTenant: "tenant.tenant.update",
  suspendTenant: "tenant.tenant.suspend",
  onboardTenant: "tenant.tenant.onboard",
  setIsolation: "tenant.tenant.set_isolation",
} as const;

export const EVENTS = {
  tenantCreated: "tenant.tenant.created",
  tenantUpdated: "tenant.tenant.updated",
  tenantSuspended: "tenant.tenant.suspended",
  tenantOnboarded: "tenant.tenant.onboarded",
  tenantIsolationChanged: "tenant.tenant.isolation_changed",
} as const;

export const SERVICE = "tenant";
export const RESOURCE = "tenant";
