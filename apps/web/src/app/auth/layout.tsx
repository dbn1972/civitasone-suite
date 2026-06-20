import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const isAuthenticated = cookies().get("civitasone_demo_auth")?.value === "1";
  if (isAuthenticated) {
    redirect("/dashboard");
  }

  return children;
}
