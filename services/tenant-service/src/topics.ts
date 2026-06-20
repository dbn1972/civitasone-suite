/** Topic + event names owned by tenant-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createTenant: "tenant.tenant.create",
  updateTenant: "tenant.tenant.update",
  suspendTenant: "tenant.tenant.suspend",
} as const;

export const EVENTS = {
  tenantCreated: "tenant.tenant.created",
  tenantUpdated: "tenant.tenant.updated",
  tenantSuspended: "tenant.tenant.suspended",
} as const;

export const SERVICE = "tenant";
export const RESOURCE = "tenant";
