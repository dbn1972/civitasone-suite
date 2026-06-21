import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

const ALLOWED = ["legal_officer", "legal_admin", "platform_admin", "super_admin", "finance_admin"];

export default function LegalLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED);
  return <>{children}</>;
}
