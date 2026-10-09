import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole, REPORTS_READER_ROLES } from "@/lib/auth/roleGuard";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  // GAP2-REPORTS-ROLES-01: gate the whole /reports route family to the
  // canonical report reader vocabulary report-service enforces across its
  // jobs/kpis/mis/dashboard/scheduled routes. The server is authoritative;
  // this web gate redirects an unauthorised user to the dashboard instead of
  // rendering a hub whose tiles 403.
  requireAnyRole(REPORTS_READER_ROLES);
  return <ModuleGate moduleKey="reports">{children}</ModuleGate>;
}
