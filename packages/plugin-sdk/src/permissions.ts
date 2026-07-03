/**
 * Permission model for the CivitasOne plugin system.
 *
 * Permissions follow the format: `service:resource:action`
 * e.g. "finance:invoice:read", "hrms:employee:write"
 */

export interface ParsedPermission {
  service: string;
  resource: string;
  action: string;
}

/**
 * Parse a raw permission string into its component parts.
 * Format: `service:resource:action`
 */
export function parsePermission(raw: string): ParsedPermission {
  const parts = raw.split(":");
  if (parts.length !== 3) {
    throw new Error(
      `Invalid permission format "${raw}". Expected "service:resource:action".`,
    );
  }
  const [service, resource, action] = parts as [string, string, string];
  if (!service || !resource || !action) {
    throw new Error(
      `Invalid permission format "${raw}". Each segment must be non-empty.`,
    );
  }
  return { service, resource, action };
}

/**
 * All valid permissions grouped by service.
 */
export const PERMISSION_CATALOG = {
  finance: {
    invoice: ["read", "write", "delete"],
    budget: ["read", "write"],
    journal: ["read", "write"],
    report: ["read"],
  },
  hrms: {
    employee: ["read", "write", "delete"],
    leave: ["read", "write"],
    attendance: ["read", "write"],
    payslip: ["read"],
  },
  procurement: {
    requisition: ["read", "write"],
    order: ["read", "write", "approve"],
    vendor: ["read", "write"],
  },
  asset: {
    item: ["read", "write", "delete"],
    transfer: ["read", "write"],
  },
  project: {
    project: ["read", "write", "delete"],
    task: ["read", "write"],
    milestone: ["read", "write"],
  },
  notification: {
    message: ["read", "write"],
    template: ["read", "write"],
  },
  workflow: {
    definition: ["read", "write"],
    instance: ["read", "write"],
  },
  citizen: {
    request: ["read", "write"],
    feedback: ["read", "write"],
  },
  store: {
    data: ["read", "write", "delete"],
  },
} as const;

export interface PermissionCheckResult {
  allowed: boolean;
  denied: string[];
}

/**
 * Check whether all requested permissions are covered by the granted set.
 * Supports wildcard matching: `service:resource:*` grants all actions,
 * `service:*:*` grants all resources and actions within a service.
 */
export function checkPermission(
  requested: string[],
  granted: string[],
): PermissionCheckResult {
  const denied: string[] = [];

  for (const req of requested) {
    const parsed = parsePermission(req);
    const isGranted = granted.some((g) => {
      const gParts = g.split(":");
      if (gParts.length !== 3) return false;
      const [gService, gResource, gAction] = gParts as [
        string,
        string,
        string,
      ];
      if (gService !== parsed.service && gService !== "*") return false;
      if (gResource !== parsed.resource && gResource !== "*") return false;
      if (gAction !== parsed.action && gAction !== "*") return false;
      return true;
    });

    if (!isGranted) {
      denied.push(req);
    }
  }

  return {
    allowed: denied.length === 0,
    denied,
  };
}
