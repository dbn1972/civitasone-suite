import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@/lib/auth/config";
import { SyncProvider } from "@/lib/sync/SyncProvider";
import { AppShell } from "../_components/ds";

export default function AppLayout({ children }: { children: ReactNode }) {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) redirect("/auth/login");

  return (
    <>
      <SyncProvider />
      <AppShell>{children}</AppShell>
    </>
  );
}
