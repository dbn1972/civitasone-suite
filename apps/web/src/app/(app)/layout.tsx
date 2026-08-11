import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@/lib/auth/config";
import { SyncProvider } from "@/lib/sync/SyncProvider";
import { getEnabledModules } from "@/lib/moduleVisibility";
import { AppShell, ToastProvider } from "../_components/ds";

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

export default async function AppLayout({ children }: { children: ReactNode }) {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) redirect("/auth/login");

  const enabledModules = await getEnabledModules();
  const userName = decodeJwtName(token);

  return (
    <ToastProvider>
      <SyncProvider />
      <AppShell enabledModules={enabledModules} userName={userName}>{children}</AppShell>
    </ToastProvider>
  );
}
