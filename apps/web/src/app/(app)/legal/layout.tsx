import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ModuleGate } from "../ModuleGate";

// GAP-LEGAL-HOME-01: finance_admin is NOT accepted by any legal-service route
// (every module gates on legal_officer/legal_admin/super_admin, with
// audit_officer as a read-only reader) — so the web module must not advertise
// Legal to finance_admin and then have the server 403 every request. audit_officer
// is included because the service grants it read access to cases/orders/etc.
const ALLOWED = ["legal_officer", "legal_admin", "platform_admin", "super_admin", "audit_officer"];

export default function LegalLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED);
  return <ModuleGate moduleKey="legal">{children}</ModuleGate>;
}
