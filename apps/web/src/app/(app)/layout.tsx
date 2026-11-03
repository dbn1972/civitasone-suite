import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@/lib/auth/config";
import { SyncProvider } from "@/lib/sync/SyncProvider";
import { getEnabledModules } from "@/lib/moduleVisibility";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { AppShell, ToastProvider } from "../_components/ds";
import { humanizeStatus } from "@/lib/formatters";
import { SessionTimeoutWarning } from "../_components/session/SessionTimeoutWarning";

const ROLE_LABELS: Record<string, string> = {
  super_admin:    "Super Admin",
  tenant_admin:   "Tenant Admin",
  finance_admin:  "Finance Admin",
  finance_staff:  "Finance Staff",
  hr_admin:       "HR Admin",
  hr_staff:       "HR Staff",
  procurement:    "Procurement",
  auditor:        "Auditor",
  viewer:         "Viewer",
};

/** Decode the JWT payload without verification (already validated by middleware). */
function decodeJwtName(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { name?: string; given_name?: string; family_name?: string; preferred_username?: string };
    return claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ") || claims.preferred_username || undefined;
  } catch {
    return undefined;
  }
}

function decodeJwtRole(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as {
      realm_access?: { roles?: string[] };
      resource_access?: { civitasone?: { roles?: string[] } };
    };
    const roles = [
      ...(claims.resource_access?.civitasone?.roles ?? []),
      ...(claims.realm_access?.roles ?? []),
    ].filter(r => !r.startsWith("offline_access") && !r.startsWith("uma_") && !r.startsWith("default-roles-"));
    // UAT-P2-D3 (A11Y-20 / UX NAV-04): the sidebar footer showed the raw Keycloak
    // composite "default-roles-civitasone". Prefer a known role, then a humanized code.
    const key = roles.find((r) => ROLE_LABELS[r]) ?? roles[0];
    return key ? (ROLE_LABELS[key] ?? humanizeStatus(key)) : undefined;
  } catch {
    return undefined;
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const token = (await cookies()).get(COOKIE.ACCESS)?.value;
  if (!token) redirect("/auth/login");

  const enabledModules = await getEnabledModules();
  const userName = decodeJwtName(token);
  const userRole = decodeJwtRole(token);
  // Real roles claim (roleGuard.ts reads the flat top-level `roles` array
  // this app's own JWTs actually carry — see packages/auth/signToken —
  // unlike decodeJwtRole above, which reads Keycloak's nested
  // realm_access/resource_access shape and keeps only one label for
  // display). Used only to hide role-gated nav entries (Finance today).
  const roles = getSessionRoles();

  return (
    <ToastProvider>
      <SyncProvider />
      <SessionTimeoutWarning />
      <AppShell enabledModules={enabledModules} userName={userName} userRole={userRole} roles={roles}>{children}</AppShell>
    </ToastProvider>
  );
}
