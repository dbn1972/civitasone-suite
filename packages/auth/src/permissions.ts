import type { RequestContext } from "@civitasone/types";
import { AuthContextError } from "./context.js";

export type PermissionCheckResult = {
  decision: "allow" | "deny";
  reason: string;
};

const POLICY_URL = () => process.env.POLICY_SERVICE_URL ?? "http://127.0.0.1:3003";

/** Fast path for super_admin without HTTP round-trip. */
export function isSuperAdmin(ctx: RequestContext): boolean {
  return ctx.roles.includes("super_admin");
}

export async function checkPermission(
  ctx: RequestContext,
  permissionKey: string,
  resource?: Record<string, unknown>,
): Promise<PermissionCheckResult> {
  if (isSuperAdmin(ctx)) {
    return { decision: "allow", reason: "role:super_admin" };
  }

  const res = await fetch(`${POLICY_URL()}/v1/policy/evaluate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal": "1",
      "x-tenant-id": ctx.tenantId,
      "x-correlation-id": ctx.correlationId,
    },
    body: JSON.stringify({
      permissionKey,
      actor: { userId: ctx.actorId, tenantId: ctx.tenantId, roles: ctx.roles },
      resource,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new AuthContextError(503, "POLICY_UNAVAILABLE", `policy evaluate failed: ${res.status}`);
  }

  return res.json() as Promise<PermissionCheckResult>;
}

export async function requirePermission(
  ctx: RequestContext,
  permissionKey: string,
  resource?: Record<string, unknown>,
): Promise<void> {
  const result = await checkPermission(ctx, permissionKey, resource);
  if (result.decision !== "allow") {
    throw new AuthContextError(403, "FORBIDDEN", result.reason);
  }
}
