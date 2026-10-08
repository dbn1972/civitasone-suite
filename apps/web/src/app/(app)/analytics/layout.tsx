import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole, ANALYTICS_READER_ROLES } from "@/lib/auth/roleGuard";

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  // GAP2-ANALYTICS-ROLES-01: gate the whole /analytics route family to the
  // canonical analytics reader vocabulary analytics-service enforces on its
  // GET routes (ANALYTICS_READ_ROLES). The server is authoritative; this web
  // gate redirects an unauthorised user to the dashboard instead of rendering
  // a hub whose tiles all 403.
  requireAnyRole(ANALYTICS_READER_ROLES);
  return <ModuleGate moduleKey="analytics">{children}</ModuleGate>;
}
