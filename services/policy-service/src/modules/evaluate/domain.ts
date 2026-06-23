export type EvaluateInput = {
  permissionKey: string;
  actor: { userId: string; tenantId: string; roles: string[] };
  resource?: Record<string, unknown>;
};

export type EvaluateResult = {
  decision: "allow" | "deny";
  reason: string;
  cacheable: boolean;
  ttlSeconds: number;
};

export function parsePermissionKey(key: string): { resource: string; action: string } {
  const parts = key.split(".");
  if (parts.length < 3) {
    throw new Error(`invalid permission key: ${key}`);
  }
  const action = parts[parts.length - 1]!;
  const resource = parts.slice(0, -1).join(".");
  return { resource, action };
}

export function evaluateDecision(
  permissionKey: string,
  actorRoles: string[],
  granted: Array<{ resource: string; action: string; effect: string; roleName: string }>,
): EvaluateResult {
  if (actorRoles.includes("super_admin")) {
    return { decision: "allow", reason: "role:super_admin", cacheable: true, ttlSeconds: 60 };
  }

  const { resource, action } = parsePermissionKey(permissionKey);
  const match = granted.find(
    (p) => p.effect === "allow" && p.resource === resource && p.action === action,
  );

  if (match) {
    return {
      decision: "allow",
      reason: `role:${match.roleName}+${resource}.${action}`,
      cacheable: true,
      ttlSeconds: 60,
    };
  }

  return {
    decision: "deny",
    reason: `no permission for ${permissionKey}`,
    cacheable: true,
    ttlSeconds: 30,
  };
}
