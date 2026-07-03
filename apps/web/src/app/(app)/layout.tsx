import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@/lib/auth/config";
import { SyncProvider } from "@/lib/sync/SyncProvider";
import { getEnabledModules } from "@/lib/moduleVisibility";
import { AppShell } from "../_components/ds";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) redirect("/auth/login");

  const enabledModules = await getEnabledModules();

  return (
    <>
      <SyncProvider />
      <AppShell enabledModules={enabledModules}>{children}</AppShell>
    </>
  );
}
