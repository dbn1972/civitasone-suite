import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@/lib/auth/config";
import { SyncProvider } from "@/lib/sync/SyncProvider";
import { getEnabledModules } from "@/lib/moduleVisibility";
import { AppShell, ToastProvider } from "../_components/ds";

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
    ].filter(r => !r.startsWith("offline_access") && !r.startsWith("uma_"));
    const key = roles[0];
    return key ? (ROLE_LABELS[key] ?? key) : undefined;
  } catch {
    return undefined;
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) redirect("/auth/login");

  const enabledModules = await getEnabledModules();
  const userName = decodeJwtName(token);
  const userRole = decodeJwtRole(token);

  return (
    <ToastProvider>
      <SyncProvider />
      <AppShell enabledModules={enabledModules} userName={userName} userRole={userRole}>{children}</AppShell>
    </ToastProvider>
  );
}
