/**
 * GAP-PLATFORM-ADMIN-USERS-04: map raw identity-service user rows to the
 * table's PlatformUser shape, DROPPING any row that lacks a real string id.
 *
 * The old page.tsx substituted `String(Math.random())` for a missing id — a
 * value that changed on every render (so React keys and the checkbox
 * selection were unstable) and that would target a FABRICATED id if an admin
 * clicked Suspend / Reset on that row. There is no safe id to invent, so such
 * a row is excluded; the actions below only ever operate on a real id.
 */
export type MappedUser = {
  id: string;
  name: string | null;
  email: string;
  roles: string[];
  status: string;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  department: string | null;
  tenantId: string | null;
};

export function mapAdminUsers(raw: readonly unknown[]): MappedUser[] {
  return raw
    .map((u) => {
      const r = u as Record<string, unknown>;
      const id = typeof r.id === "string" && r.id.length > 0 ? r.id : null;
      if (!id) return null;
      return {
        id,
        name: (r.name as string | null) ?? null,
        email: (r.email as string) ?? "",
        roles: Array.isArray(r.roles) ? (r.roles as unknown[]).filter((x): x is string => typeof x === "string") : [],
        status: (r.status as string) ?? "active",
        lastLoginAt: (r.lastLoginAt as string | null) ?? null,
        mfaEnabled: (r.mfaEnabled as boolean) ?? false,
        department: (r.department as string | null) ?? null,
        tenantId: (r.tenantId as string | null) ?? null,
      } satisfies MappedUser;
    })
    .filter((u): u is MappedUser => u !== null);
}
