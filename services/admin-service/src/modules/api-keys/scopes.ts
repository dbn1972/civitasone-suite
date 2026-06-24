import type { RequestContext } from "@civitasone/types";

/**
 * P1-5: scope policy for admin api-keys. A caller may only mint a key with
 * scopes their own role is allowed to grant -- no privilege escalation via an
 * api-key. Platform roles may grant any scope; a tenant_admin is confined to a
 * tenant-level allow-list.
 */
const PLATFORM_ROLES = ["super_admin", "platform_admin"];

// Scopes a tenant_admin is permitted to delegate to an api-key.
const TENANT_ADMIN_SCOPES = new Set<string>([
  "config:read",
  "config:write",
  "tenant:read",
  "backup:read",
  "api-keys:read",
]);

export function allowsAllScopes(ctx: RequestContext): boolean {
  return ctx.roles.some((r) => PLATFORM_ROLES.includes(r));
}

/** Return the subset of requested scopes the caller is NOT allowed to grant. */
export function disallowedScopes(ctx: RequestContext, requested: string[]): string[] {
  if (allowsAllScopes(ctx)) return [];
  return requested.filter((s) => !TENANT_ADMIN_SCOPES.has(s));
}
